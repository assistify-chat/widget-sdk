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
  setContext: (...args: unknown[]) => unknown;
  clearContext: (...args: unknown[]) => unknown;
  on: (...args: unknown[]) => unknown;
  off: (...args: unknown[]) => unknown;
  isReady?: () => boolean;
  getVisitorId?: () => string | null;
  [k: string]: unknown;
}

type FlatMethod =
  | 'open' | 'close' | 'toggle'
  | 'reset' | 'destroy' | 'identify'
  | 'setContext' | 'clearContext'
  | 'on' | 'off';

interface PendingCall {
  method: FlatMethod;
  args: unknown[];
  resolve?: (value: unknown) => void;
  reject?: (err: unknown) => void;
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

/**
 * Like {@link dispatch} but tracks a Promise so async callers (`load`, `reset`,
 * `identify`) settle once the queued call has actually been replayed against
 * the runtime.
 */
export function dispatchAsync(method: FlatMethod, args: unknown[]): Promise<void> {
  const a = readAssistify();
  if (a) {
    const fn = a[method];
    if (typeof fn === 'function') {
      const out = (fn as (...a: unknown[]) => unknown).apply(a, args);
      return out instanceof Promise ? (out as Promise<void>) : Promise.resolve();
    }
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    pendingCalls.push({ method, args, resolve: resolve as (v: unknown) => void, reject });
  });
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
 */
export function drainPendingCalls(): void {
  const a = readAssistify();
  if (!a) return;
  const batch = pendingCalls.splice(0, pendingCalls.length);
  for (const call of batch) {
    try {
      const fn = a[call.method];
      if (typeof fn !== 'function') {
        call.resolve?.(undefined);
        continue;
      }
      const out = (fn as (...args: unknown[]) => unknown).apply(a, call.args);
      if (out instanceof Promise) {
        out.then(
          (v) => call.resolve?.(v),
          (e) => call.reject?.(e),
        );
      } else {
        call.resolve?.(out);
      }
    } catch (err) {
      call.reject?.(err);
    }
  }
}

/** Test-only escape hatch. Not exported from the package barrel. */
export function __resetQueueForTests(): void {
  pendingCalls.length = 0;
}
