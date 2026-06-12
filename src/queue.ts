/**
 * Pre-boot internal buffer + namespaced→flat dispatch against window.Assistify.
 *
 * Covers the window between `mount()` returning and the loader IIFE installing
 * `window.Assistify` on the page. Once the IIFE has run, every call is forwarded
 * synchronously to `window.Assistify[method](...args)`; the loader's own queue
 * proxy then absorbs anything sent before the ESM runtime drains it.
 */

import { readVisitorIdFromStorage } from './visitor-id-storage';

interface AssistifyGlobal {
  open: (...args: unknown[]) => unknown;
  close: (...args: unknown[]) => unknown;
  toggle: (...args: unknown[]) => unknown;
  reset: (...args: unknown[]) => unknown;
  destroy: (...args: unknown[]) => unknown;
  identify: (...args: unknown[]) => unknown;
  on: (...args: unknown[]) => unknown;
  off: (...args: unknown[]) => unknown;
  isReady?: () => boolean;
  getVisitorId?: () => string | null;
  /**
   * Present only on the runtime's post-destroy revival stub: re-boots the
   * widget with no other side effect. Absent on the live runtime and on the
   * loader proxy, where dispatching 'boot' is a silent no-op by design.
   */
  boot?: () => void;
  [k: string]: unknown;
}

type FlatMethod =
  | 'open' | 'close' | 'toggle'
  | 'reset' | 'destroy' | 'identify'
  | 'on' | 'off' | 'boot';

interface PendingCall {
  method: FlatMethod;
  args: unknown[];
}

const pendingCalls: PendingCall[] = [];

export function readAssistify(): AssistifyGlobal | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { Assistify?: unknown };
  const a = w.Assistify;
  return typeof a === 'object' && a !== null ? (a as AssistifyGlobal) : null;
}

/**
 * Forward a queueable call. If the runtime is on the page (loader IIFE has
 * installed `window.Assistify`), invokes it synchronously and returns the
 * result. Otherwise buffers it locally; the call is drained later by
 * {@link drainPendingCalls}.
 */
export function dispatch(method: FlatMethod, args: unknown[]): unknown {
  const a = readAssistify();
  if (a) {
    const fn = a[method];
    if (typeof fn === 'function') {
      return (fn as (...a: unknown[]) => unknown).apply(a, args);
    }
    return undefined;
  }
  pendingCalls.push({ method, args });
  return undefined;
}

/** Read pre-boot. Returns `false` when the runtime is not yet installed. */
export function readIsReady(): boolean {
  const a = readAssistify();
  if (!a || typeof a.isReady !== 'function') return false;
  return a.isReady();
}

/**
 * Read the visitor id with full fallback chain.
 *
 *   1. `window.Assistify.getVisitorId()` once the loader IIFE has installed
 *      its queue proxy. The loader proxy itself reads from cookie/localStorage.
 *   2. Direct cookie + localStorage read via the in-package helper. Covers
 *      the window between `mount()` returning and the loader IIFE executing,
 *      and any case where the loader script is blocked or slow.
 *   3. `null` if no Assistify, no widgetId, or no persisted ID exists.
 */
export function readVisitorId(widgetId: string | null): string | null {
  const a = readAssistify();
  if (a && typeof a.getVisitorId === 'function') return a.getVisitorId();
  if (!widgetId) return null;
  return readVisitorIdFromStorage(widgetId);
}

/**
 * Replay every buffered call against `window.Assistify`. Called by `mount.ts`
 * from `script.onload`. Idempotent; subsequent invocations replay nothing.
 *
 * Calls are intentionally fire-and-forget: the SDK does not promise that
 * the call has been applied by the runtime when this returns. Hosts that
 * need a completion signal should observe the corresponding event on the
 * returned handle (`'ready'` for boot, `'identified'` for identify, etc).
 */
export function drainPendingCalls(): void {
  const a = readAssistify();
  if (!a) return;
  const batch = pendingCalls.splice(0, pendingCalls.length);
  for (const call of batch) {
    try {
      const fn = a[call.method];
      if (typeof fn !== 'function') continue;
      (fn as (...args: unknown[]) => unknown).apply(a, call.args);
    } catch (err) {
      console.error('[assistify] drain ' + call.method + ' threw', err);
    }
  }
}

/** Test-only escape hatch. Not exported from the package barrel. */
export function __resetQueueForTests(): void {
  pendingCalls.length = 0;
}
