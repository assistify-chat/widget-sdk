/**
 * mount(): script injection, idempotent legacy detection, handle factory.
 *
 * One widget per page. Module state (loader script element, in-flight load
 * promise) is shared across every mount() call.
 */

import type {
  MountOptions,
  WidgetContext,
  WidgetEvent,
  WidgetEventPayload,
  WidgetHandle,
  WidgetIdentity,
} from './types';
import {
  dispatch,
  dispatchAsync,
  drainPendingCalls,
  readAssistify,
  readIsReady,
  readVisitorId,
} from './queue';

const DEFAULT_BASE_URL = 'https://assistify.chat';
const LOAD_TIMEOUT_MS = 30_000;

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
 * `customAttributes` is the only identity field that cannot ride on data-attrs
 * (arbitrary JSON does not fit cleanly in HTML attributes). When present, fire
 * a post-boot identify carrying the full identity; the backend merges
 * customAttributes onto the contact matched by anchor (email/externalId/discordId)
 * and re-verifies userHash, so the same session cost as the boot-time path.
 */
function queueCustomAttributesIdentity(identity: WidgetIdentity): void {
  if (!identity.customAttributes) return;
  void dispatchAsync('identify', [identity]);
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

function ensureInstalled(opts: MountOptions): void {
  if (!inBrowser()) return;
  if (state.destroyed) return;

  // Already installed by this SDK instance.
  if (state.scriptEl) return;

  const existing = findExistingLoaderScript();
  if (existing) {
    const existingId = existing.getAttribute('data-widget-id') ?? '<unknown>';
    if (existingId === opts.widgetId) {
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
      `[assistify] mount() called with widgetId="${opts.widgetId}" but a script ` +
      `for widgetId="${existingId}" is already on the page. Only one widget per page is supported.`,
    );
  }

  (window as unknown as { CHATBOT_CONFIG?: { widgetId: string } }).CHATBOT_CONFIG = {
    widgetId: opts.widgetId,
  };

  const script = document.createElement('script');
  script.async = true;
  script.src = buildScriptSrc(state.baseUrl);
  // Matches the CORS headers assistify.chat serves the loader with. Keeps
  // SRI and strict-CSP hosts happy.
  script.crossOrigin = 'anonymous';
  script.setAttribute('data-assistify-loader', '');
  script.setAttribute('data-widget-id', opts.widgetId);

  if (opts.identity) applyIdentityAttrs(script, opts.identity);

  script.onload = () => {
    state.scriptStatus = 'loaded';
    drainPendingCalls();
    // Anything queued (e.g. context, overflow identify fields) is now on
    // the loader's _queue and will be replayed by the runtime on boot.
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

  if (opts.identity) queueCustomAttributesIdentity(opts.identity);
  if (opts.context) void dispatchAsync('setContext', [opts.context]);
}

function loadOnce(opts: MountOptions): Promise<void> {
  if (!inBrowser()) return Promise.resolve();
  if (state.loadPromise) return state.loadPromise;

  state.loadPromise = new Promise<void>((resolve, reject) => {
    try {
      ensureInstalled(opts);
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
      // splice this resolver out; handled by the ready callback path
      const idx = state.loadResolvers.indexOf(resolve);
      if (idx >= 0) state.loadResolvers.splice(idx, 1);
      const ridx = state.loadRejecters.indexOf(reject);
      if (ridx >= 0) state.loadRejecters.splice(ridx, 1);
      resolve();
    };
    dispatch('on', ['ready', cb]);

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
    reset: async () => { warn('reset'); },
    destroy: () => warn('destroy'),
    isReady: () => false,
    chat: {
      open: () => warn('chat.open'),
      close: () => warn('chat.close'),
      toggle: () => warn('chat.toggle'),
    },
    user: {
      identify: async () => { warn('user.identify'); },
      getVisitorId: () => null,
    },
    context: {
      set: () => warn('context.set'),
      clear: () => warn('context.clear'),
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
 *   surfaces.
 *
 * @example
 * ```ts
 * import { mount } from '@assistifychat/widget';
 * const widget = mount({ widgetId: 'YOUR_WIDGET_ID' });
 * widget.events.on('ready', () => console.log('Assistify ready'));
 * ```
 */
export function mount(opts: MountOptions): WidgetHandle {
  if (!inBrowser()) return makeNoopHandle();

  state.widgetId = opts.widgetId;
  state.baseUrl = normaliseBaseUrl(opts.baseUrl);
  state.destroyed = false;

  const autoload = opts.autoload !== false;
  if (autoload) ensureInstalled(opts);

  const ensureLoaded = (): void => {
    if (state.scriptEl) return;
    void loadOnce(opts).catch(() => { /* swallow; surfaced via load() */ });
  };

  const handle: WidgetHandle = {
    load: () => loadOnce(opts),
    reset: () => {
      ensureLoaded();
      return dispatchAsync('reset', []);
    },
    destroy: () => {
      dispatch('destroy', []);
      state.destroyed = true;
    },
    isReady: () => readIsReady(),

    chat: {
      open: () => { ensureLoaded(); dispatch('open', []); },
      close: () => { ensureLoaded(); dispatch('close', []); },
      toggle: () => { ensureLoaded(); dispatch('toggle', []); },
    },

    user: {
      identify: (identity) => {
        ensureLoaded();
        return dispatchAsync('identify', [identity]);
      },
      getVisitorId: () => readVisitorId(state.widgetId),
    },

    context: {
      set: (ctx: WidgetContext) => { ensureLoaded(); dispatch('setContext', [ctx]); },
      clear: () => { ensureLoaded(); dispatch('clearContext', []); },
    },

    events: {
      on: <E extends WidgetEvent>(
        event: E,
        callback: (payload: WidgetEventPayload<E>) => void,
      ): (() => void) => {
        ensureLoaded();
        const result = dispatch('on', [event, callback]);
        if (typeof result === 'function') return result as () => void;
        return () => { /* inert; see TSDoc on WidgetHandle.events.on */ };
      },
      off: <E extends WidgetEvent>(
        event: E,
        callback?: (payload: WidgetEventPayload<E>) => void,
      ): void => {
        ensureLoaded();
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
}
