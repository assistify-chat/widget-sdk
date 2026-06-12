/**
 * mount(): script injection, idempotent legacy detection, handle factory.
 *
 * One widget per page. Module state (loader script element, in-flight load
 * promise, last-known identity) is shared across every mount() call.
 *
 * Boot triggers vs. buffer-only:
 *   - Boot-triggering: load(), chat.open/close/toggle, and reset() once the
 *     loader script is on the page.
 *   - Buffer-only:     user.identify, events.on/off.
 *   - reset() before the loader script exists clears local visitor storage
 *     and returns: a logout must never load the widget or fire network
 *     activity on a page where loading was deferred.
 *
 * Revival: after destroy() the runtime swaps window.Assistify for a stub
 * whose `boot` method re-runs the full boot. mount() and load() dispatch
 * 'boot' to it; on a live runtime or the loader proxy that dispatch is a
 * silent no-op.
 *
 * Identity updates accumulate in `state.currentIdentity` so the latest values
 * are written onto the script tag when boot eventually fires, regardless of
 * which call triggered it.
 */

import type {
  MountOptions,
  WidgetEvent,
  WidgetEventPayload,
  WidgetHandle,
  WidgetIdentity,
} from './types';
import {
  dispatch,
  drainPendingCalls,
  readAssistify,
  readIsReady,
  readVisitorId,
} from './queue';
import { clearVisitorIdFromStorage } from './visitor-id-storage';

const DEFAULT_BASE_URL = 'https://assistify.chat';
const LOAD_TIMEOUT_MS = 30_000;
const WIDGET_ID_PATTERN = /^[0-9a-f]{16}$/;
const PLACEHOLDER_WIDGET_IDS = new Set([
  'WIDGET_ID',
  'widget_id',
  'WIDGET-ID',
  'widget-id',
  'REPLACE_ME',
  'replace_me',
]);

/**
 * Surface a console error for the common copy-paste mistake of leaving the
 * doc placeholder in production, or for the obvious format mismatch when
 * the host has pasted something that cannot be a tenant widget ID.
 *
 * Never throws. The widget must never break the page that embeds it, so the
 * call proceeds and the backend rejects the boot request; a loud console
 * line is enough to surface the typo during integration.
 */
function warnInvalidWidgetId(widgetId: string): void {
  if (PLACEHOLDER_WIDGET_IDS.has(widgetId)) {
    console.error(
      '[assistify] mount() received placeholder widgetId "' + widgetId + '". ' +
      'Copy your real widget ID from Dashboard → Widget → Settings → Credentials.',
    );
    return;
  }
  if (!WIDGET_ID_PATTERN.test(widgetId)) {
    console.error(
      '[assistify] mount() received widgetId "' + widgetId + '" which is not ' +
      '16 lowercase hex characters. The backend will reject the boot request. ' +
      'Copy your widget ID from Dashboard → Widget → Settings → Credentials.',
    );
  }
}

interface MountState {
  widgetId: string | null;
  baseUrl: string;
  scriptEl: HTMLScriptElement | null;
  scriptStatus: 'idle' | 'pending' | 'loaded' | 'errored';
  scriptError: Error | null;
  loadPromise: Promise<void> | null;
  loadRejecters: Array<(err: Error) => void>;
  loadResolvers: Array<() => void>;
  destroyed: boolean;
  /**
   * Latest identity supplied via `mount({ identity })` or `user.identify()`.
   * Read at script-injection time so deferred boots carry the right data-user-*
   * attributes regardless of which call set the identity.
   */
  currentIdentity: WidgetIdentity | null;
  /**
   * True between `reset()` and the next `'ready'` event. While true,
   * `user.identify()` buffers in `pendingPostResetIdentity` instead of firing
   * immediately, so the identify applies to the post-reset session rather
   * than the one currently being torn down.
   */
  resetting: boolean;
  pendingPostResetIdentity: WidgetIdentity | null;
  /**
   * Unsubscribe for the in-flight reset's `'ready'` listener. Kept so a second
   * `reset()` before the first ready can cancel the previous listener cleanly.
   */
  pendingResetUnsubscribe: (() => void) | null;
}

const state: MountState = {
  widgetId: null,
  baseUrl: DEFAULT_BASE_URL,
  scriptEl: null,
  scriptStatus: 'idle',
  scriptError: null,
  loadPromise: null,
  loadRejecters: [],
  loadResolvers: [],
  destroyed: false,
  currentIdentity: null,
  resetting: false,
  pendingPostResetIdentity: null,
  pendingResetUnsubscribe: null,
};

const inBrowser = (): boolean =>
  typeof window !== 'undefined' && typeof document !== 'undefined';

function normaliseBaseUrl(raw: string | undefined): string {
  return (raw ?? DEFAULT_BASE_URL).replace(/\/$/, '');
}

function buildScriptSrc(baseUrl: string): string {
  return `${baseUrl}/widget/widget.js`;
}

function applyIdentityAttrs(script: HTMLScriptElement, identity: WidgetIdentity): void {
  const map: Record<string, string | undefined> = {
    'data-user-email': identity.email,
    'data-user-external-id': identity.externalId,
    'data-user-discord-id': identity.discordId,
    'data-user-discord-username': identity.discordUsername,
    'data-user-discord-avatar': identity.discordAvatar,
    'data-user-name': identity.displayName,
    'data-user-avatar': identity.avatarUrl,
    'data-user-hash': identity.userHash,
  };
  for (const [attr, value] of Object.entries(map)) {
    if (typeof value === 'string' && value.length > 0) {
      script.setAttribute(attr, value);
    }
  }
}

/**
 * Shallow merge per top-level key. `email/externalId/userHash` on the new
 * payload override the old; objects like `customAttributes` are replaced
 * wholesale because partial deep-merge surprises hosts more often than it
 * helps.
 */
function mergeIdentity(
  current: WidgetIdentity | null,
  incoming: WidgetIdentity,
): WidgetIdentity {
  return { ...(current ?? {}), ...incoming };
}

function findExistingLoaderScript(): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>(
    'script[src*="/widget/widget.js"]',
  );
}

/**
 * Poll for `window.Assistify` after we detected a pre-existing legacy script
 * whose IIFE has not run yet. Once the loader installs its proxy, drain any
 * calls that were buffered locally between `mount()` returning and this
 * point. Capped at `LOAD_TIMEOUT_MS`. The user-visible timeout is surfaced
 * by `load()` itself.
 */
function schedulePostLegacyDrain(): void {
  const pollStart = Date.now();
  const interval = setInterval(() => {
    if (readAssistify()) {
      clearInterval(interval);
      state.scriptStatus = 'loaded';
      drainPendingCalls();
      return;
    }
    if (Date.now() - pollStart > LOAD_TIMEOUT_MS) {
      clearInterval(interval);
    }
  }, 50);
}

function ensureInstalled(): void {
  if (!inBrowser()) return;
  if (state.destroyed) return;
  if (!state.widgetId) return;

  // Already installed by this SDK instance.
  if (state.scriptEl) return;

  const existing = findExistingLoaderScript();
  if (existing) {
    const existingId = existing.getAttribute('data-widget-id') ?? '<unknown>';
    if (existingId === state.widgetId) {
      state.scriptEl = existing;
      if (readAssistify()) {
        state.scriptStatus = 'loaded';
      } else {
        // Legacy script is on the page but its IIFE has not executed yet.
        // Poll for `window.Assistify`; drain pendingCalls when it appears.
        state.scriptStatus = 'pending';
        schedulePostLegacyDrain();
      }
      return;
    }
    throw new Error(
      `[assistify] mount() called with widgetId="${state.widgetId}" but a script ` +
      `for widgetId="${existingId}" is already on the page. Only one widget per page is supported.`,
    );
  }

  (window as unknown as { ASSISTIFY_CONFIG?: { widgetId: string } }).ASSISTIFY_CONFIG = {
    widgetId: state.widgetId,
  };

  const script = document.createElement('script');
  script.async = true;
  script.src = buildScriptSrc(state.baseUrl);
  // Matches the CORS headers assistify.chat serves the loader with. Keeps
  // SRI and strict-CSP hosts happy.
  script.crossOrigin = 'anonymous';
  script.setAttribute('data-assistify-loader', '');
  script.setAttribute('data-widget-id', state.widgetId);

  if (state.currentIdentity) applyIdentityAttrs(script, state.currentIdentity);

  script.onload = () => {
    state.scriptStatus = 'loaded';
    drainPendingCalls();
  };
  script.onerror = () => {
    const err = new Error(
      '[assistify] failed to load widget.js: network error, CSP, or adblocker',
    );
    state.scriptStatus = 'errored';
    state.scriptError = err;
    const rejecters = state.loadRejecters.splice(0, state.loadRejecters.length);
    state.loadResolvers.length = 0;
    for (const reject of rejecters) reject(err);
  };

  state.scriptStatus = 'pending';
  state.scriptEl = script;
  document.head.appendChild(script);

  // Buffer a post-boot identify when `customAttributes` is present — that one
  // field cannot be carried by data-attrs, so the runtime needs the full
  // payload through the normal identify channel.
  if (state.currentIdentity?.customAttributes) {
    dispatch('identify', [state.currentIdentity]);
  }
}

function loadOnce(): Promise<void> {
  if (!inBrowser()) return Promise.resolve();
  if (state.loadPromise) return state.loadPromise;

  state.loadPromise = new Promise<void>((resolve, reject) => {
    try {
      ensureInstalled();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    if (state.scriptStatus === 'errored' && state.scriptError) {
      reject(state.scriptError);
      return;
    }

    if (readIsReady()) {
      resolve();
      return;
    }

    state.loadResolvers.push(resolve);
    state.loadRejecters.push(reject);

    const cb = (): void => {
      const idx = state.loadResolvers.indexOf(resolve);
      if (idx >= 0) state.loadResolvers.splice(idx, 1);
      const ridx = state.loadRejecters.indexOf(reject);
      if (ridx >= 0) state.loadRejecters.splice(ridx, 1);
      resolve();
    };
    dispatch('on', ['ready', cb]);
    // Post-destroy revival: only the runtime's revival stub implements
    // 'boot'; on first load the script injection above is what boots, and
    // this dispatch is a no-op.
    dispatch('boot', []);

    setTimeout(() => {
      if (readIsReady()) {
        cb();
        return;
      }
      const timeoutErr = new Error('[assistify] load() timed out');
      const idx = state.loadResolvers.indexOf(resolve);
      if (idx >= 0) state.loadResolvers.splice(idx, 1);
      const ridx = state.loadRejecters.indexOf(reject);
      if (ridx >= 0) state.loadRejecters.splice(ridx, 1);
      reject(timeoutErr);
    }, LOAD_TIMEOUT_MS);
  });

  return state.loadPromise;
}

function makeNoopHandle(): WidgetHandle {
  const warn = (m: string): void => {
    if (
      typeof process !== 'undefined' &&
      process.env &&
      process.env.NODE_ENV !== 'production'
    ) {
      console.warn(`[assistify] ${m}() called outside the browser, no-op.`);
    }
  };
  return {
    load: async () => { warn('load'); },
    reset: () => warn('reset'),
    destroy: () => warn('destroy'),
    isReady: () => false,
    chat: {
      open: () => warn('chat.open'),
      close: () => warn('chat.close'),
      toggle: () => warn('chat.toggle'),
    },
    user: {
      identify: () => warn('user.identify'),
      getVisitorId: () => null,
    },
    events: {
      on: () => () => { /* no-op */ },
      off: () => { /* no-op */ },
    },
  };
}

/**
 * Mount the Assistify widget on the host page.
 *
 * @throws {Error} If a `<script src=".../widget/widget.js">` is already on
 *   the page with a different `widgetId`. Multiple widgets per page are not
 *   supported. Silently swallowing the second call would mean a typo never
 *   surfaces. With `autoload: false` the error surfaces as a `load()`
 *   rejection instead of a throw.
 *
 * @example
 * ```ts
 * import { mount } from '@assistifychat/widget';
 * const widget = mount({ widgetId: 'WIDGET_ID' });
 * widget.events.on('ready', () => console.log('Assistify ready'));
 * ```
 */
export function mount(opts: MountOptions): WidgetHandle {
  if (!inBrowser()) return makeNoopHandle();

  warnInvalidWidgetId(opts.widgetId);

  state.widgetId = opts.widgetId;
  state.baseUrl = normaliseBaseUrl(opts.baseUrl);
  state.destroyed = false;
  if (opts.identity) state.currentIdentity = mergeIdentity(state.currentIdentity, opts.identity);

  const autoload = opts.autoload !== false;
  if (autoload) {
    ensureInstalled();
    // Revival path: after destroy() the runtime leaves a stub on
    // window.Assistify whose `boot` re-runs the full boot. On a first mount
    // the global is absent (or is the loader proxy / live runtime, neither
    // of which has `boot`), so this is a no-op everywhere else.
    if (readAssistify()) dispatch('boot', []);
  }

  const triggerBoot = (): void => {
    if (state.scriptEl) return;
    void loadOnce().catch(() => { /* surfaced via load() */ });
  };

  /**
   * One-shot drain fired by the post-reset `'ready'` event. Clears the
   * resetting gate and replays any `user.identify()` calls made during the
   * reset window so they apply to the new session.
   */
  const drainPostResetIdentify = (): void => {
    if (state.pendingResetUnsubscribe) {
      state.pendingResetUnsubscribe();
      state.pendingResetUnsubscribe = null;
    }
    state.resetting = false;
    const pending = state.pendingPostResetIdentity;
    state.pendingPostResetIdentity = null;
    if (pending) {
      state.currentIdentity = mergeIdentity(state.currentIdentity, pending);
      dispatch('identify', [pending]);
    }
  };

  const handle: WidgetHandle = {
    load: () => loadOnce(),
    reset: () => {
      // Pre-load logout: no script on the page means no session to wipe
      // server-side and no runtime to re-boot. Clear local recognition and
      // stop. Loading the widget here would contradict the deferred-boot
      // contract (a consent-gated page must stay free of widget network
      // activity, and a logout button must not render a chat launcher).
      if (!state.scriptEl && !findExistingLoaderScript()) {
        if (state.widgetId) clearVisitorIdFromStorage(state.widgetId);
        state.currentIdentity = null;
        return;
      }
      triggerBoot();
      // Replace any previous reset's listener so chained reset() calls don't
      // pile up.
      if (state.pendingResetUnsubscribe) {
        state.pendingResetUnsubscribe();
        state.pendingResetUnsubscribe = null;
      }
      state.resetting = true;
      state.pendingPostResetIdentity = null;
      const unsubResult = dispatch('on', ['ready', drainPostResetIdentify]);
      state.pendingResetUnsubscribe =
        typeof unsubResult === 'function' ? (unsubResult as () => void) : null;
      dispatch('reset', []);
      // Drop any cached identity so the next user.identify() starts from a
      // clean slate — otherwise a shallow-merge of the new payload would
      // inherit the previous user's avatarUrl, customAttributes, etc.
      state.currentIdentity = null;
    },
    destroy: () => {
      dispatch('destroy', []);
      state.destroyed = true;
      // The runtime swaps in a re-bootable stub on destroy. Drop the settled
      // load promise so a post-revival load() awaits the next 'ready' instead
      // of resolving against the torn-down boot.
      state.loadPromise = null;
      if (state.pendingResetUnsubscribe) {
        state.pendingResetUnsubscribe();
        state.pendingResetUnsubscribe = null;
      }
      state.resetting = false;
      state.pendingPostResetIdentity = null;
    },
    isReady: () => readIsReady(),

    chat: {
      open: () => { triggerBoot(); dispatch('open', []); },
      close: () => { triggerBoot(); dispatch('close', []); },
      toggle: () => { triggerBoot(); dispatch('toggle', []); },
    },

    user: {
      identify: (identity) => {
        state.currentIdentity = mergeIdentity(state.currentIdentity, identity);
        if (state.resetting) {
          // Hold until the post-reset 'ready' event so the identify applies to
          // the new session rather than the one being torn down.
          state.pendingPostResetIdentity = mergeIdentity(
            state.pendingPostResetIdentity,
            identity,
          );
          return;
        }
        // No boot trigger. The call is dispatched (buffered pre-boot, forwarded
        // post-boot). Pre-boot, the next script injection also reads
        // state.currentIdentity and writes the identity fields onto the
        // data-user-* attrs.
        dispatch('identify', [identity]);
      },
      getVisitorId: () => readVisitorId(state.widgetId),
    },

    events: {
      on: <E extends WidgetEvent>(
        event: E,
        callback: (payload: WidgetEventPayload<E>) => void,
      ): (() => void) => {
        dispatch('on', [event, callback]);
        // Uniform unsubscribe: route `off` through whatever is live when it
        // is called. Pre-boot it queues behind the `on` and cancels it on
        // replay; post-boot it removes the listener directly. Either way it
        // works, so no lifecycle caveat leaks into the public contract.
        return () => {
          dispatch('off', [event, callback]);
        };
      },
      off: <E extends WidgetEvent>(
        event: E,
        callback?: (payload: WidgetEventPayload<E>) => void,
      ): void => {
        dispatch('off', callback === undefined ? [event] : [event, callback]);
      },
    },
  };

  return handle;
}

/** Test-only escape hatch. Not exported from the package barrel. */
export function __resetMountForTests(): void {
  state.widgetId = null;
  state.baseUrl = DEFAULT_BASE_URL;
  state.scriptEl = null;
  state.scriptStatus = 'idle';
  state.scriptError = null;
  state.loadPromise = null;
  state.loadRejecters.length = 0;
  state.loadResolvers.length = 0;
  state.destroyed = false;
  state.currentIdentity = null;
  state.resetting = false;
  state.pendingPostResetIdentity = null;
  state.pendingResetUnsubscribe = null;
}
