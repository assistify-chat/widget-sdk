import { describe, expect, it } from 'vitest';
import {
  dispatch,
  dispatchAsync,
  drainPendingCalls,
  readIsReady,
  readVisitorId,
} from '../src/queue';

type AnyFn = (...args: unknown[]) => unknown;

interface StubAssistify {
  open: ReturnType<typeof makeSpy>;
  identify: ReturnType<typeof makeSpy>;
  on: ReturnType<typeof makeSpy>;
  isReady: () => boolean;
  getVisitorId: () => string | null;
}

function makeSpy<R = unknown>(fn: (...args: unknown[]) => R): {
  (...args: unknown[]): R;
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  const spy = ((...args: unknown[]): R => {
    calls.push(args);
    return fn(...args);
  }) as AnyFn & { calls: unknown[][] };
  spy.calls = calls;
  return spy as never;
}

function installAssistify(overrides: Partial<StubAssistify> = {}): StubAssistify {
  const stub: StubAssistify = {
    open: makeSpy(() => undefined),
    identify: makeSpy(() => Promise.resolve()),
    on: makeSpy(() => () => { /* unsub */ }),
    isReady: () => true,
    getVisitorId: () => 'anon_' + 'A'.repeat(22),
    ...overrides,
  };
  (window as unknown as { Assistify?: unknown }).Assistify = stub;
  return stub;
}

describe('dispatch / drain', () => {
  it('forwards synchronously when window.Assistify exists, preserving return', () => {
    const stub = installAssistify();
    const unsub = dispatch('on', ['ready', () => { /* cb */ }]);
    expect(typeof unsub).toBe('function');
    expect(stub.on.calls.length).toBe(1);
  });

  it('buffers when no Assistify and replays in order on drain', () => {
    dispatch('open', []);
    dispatch('identify', [{ email: 'a@b.c' }]);
    const stub = installAssistify();
    drainPendingCalls();
    expect(stub.open.calls.length).toBe(1);
    expect(stub.identify.calls.length).toBe(1);
  });

  it('drainPendingCalls is idempotent', () => {
    dispatch('open', []);
    const stub = installAssistify();
    drainPendingCalls();
    drainPendingCalls();
    expect(stub.open.calls.length).toBe(1);
  });

  it('dispatchAsync resolves once the queued call lands on the runtime', async () => {
    const promise = dispatchAsync('identify', [{ email: 'a@b.c' }]);
    installAssistify();
    drainPendingCalls();
    await expect(promise).resolves.toBeUndefined();
  });
});

describe('readIsReady', () => {
  it('returns false without Assistify', () => {
    expect(readIsReady()).toBe(false);
  });
});

describe('readVisitorId', () => {
  const widgetId = 'demo';
  const validId = 'anon_' + 'A'.repeat(22);

  it('returns loader-proxy value when Assistify exists', () => {
    installAssistify({ getVisitorId: () => validId });
    expect(readVisitorId(widgetId)).toBe(validId);
  });

  it('falls back to cookie when no Assistify', () => {
    document.cookie = `assistify.${widgetId}.vid=${validId}; Path=/`;
    expect(readVisitorId(widgetId)).toBe(validId);
  });

  it('falls back to localStorage when no Assistify and no cookie', () => {
    window.localStorage.setItem(`assistify.${widgetId}.vid`, validId);
    expect(readVisitorId(widgetId)).toBe(validId);
  });

  it('returns null when widgetId is missing even with a persisted value', () => {
    window.localStorage.setItem(`assistify.${widgetId}.vid`, validId);
    expect(readVisitorId(null)).toBe(null);
  });

  it('returns null when persisted value fails the regex', () => {
    window.localStorage.setItem(`assistify.${widgetId}.vid`, 'corrupt');
    expect(readVisitorId(widgetId)).toBe(null);
  });
});
