import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, __resetMountForTests } from '../src/mount';
import { __resetQueueForTests } from '../src/queue';

type LoaderAssistify = {
  _isLoader: true;
  _queue: Array<{ method: string; args: unknown[] }>;
  open: (...a: unknown[]) => void;
  close: (...a: unknown[]) => void;
  toggle: (...a: unknown[]) => void;
  reset: (...a: unknown[]) => void;
  destroy: (...a: unknown[]) => void;
  identify: (...a: unknown[]) => void;
  setContext: (...a: unknown[]) => void;
  clearContext: (...a: unknown[]) => void;
  on: (...a: unknown[]) => () => void;
  off: (...a: unknown[]) => void;
  isReady: () => boolean;
  getVisitorId: () => string | null;
};

/** Mimic the loader IIFE: install the queue proxy on window.Assistify. */
function installLoaderProxy(): LoaderAssistify {
  const queue: Array<{ method: string; args: unknown[] }> = [];
  const methods = ['open','close','toggle','reset','destroy','identify','setContext','clearContext','on','off'] as const;
  const proxy = {} as Record<string, unknown>;
  for (const m of methods) {
    proxy[m] = (...args: unknown[]) => {
      queue.push({ method: m, args });
      return () => { /* noop */ };
    };
  }
  proxy.isReady = () => false;
  proxy.getVisitorId = () => null;
  proxy._isLoader = true;
  proxy._queue = queue;
  (window as unknown as { Assistify?: unknown }).Assistify = proxy;
  return proxy as unknown as LoaderAssistify;
}

function uninstallAssistify(): void {
  delete (window as unknown as { Assistify?: unknown }).Assistify;
  delete (window as unknown as { CHATBOT_CONFIG?: unknown }).CHATBOT_CONFIG;
}

function removeAllLoaderScripts(): void {
  document.querySelectorAll('script[src*="/widget/widget.js"]').forEach((s) => s.remove());
}

beforeEach(() => {
  __resetMountForTests();
  __resetQueueForTests();
  uninstallAssistify();
  removeAllLoaderScripts();
});

afterEach(() => {
  __resetMountForTests();
  __resetQueueForTests();
  uninstallAssistify();
  removeAllLoaderScripts();
});

describe('mount() script injection', () => {
  it('injects a loader script with the expected attributes', () => {
    mount({ widgetId: 'aaaaaaaaaaaaaaaa' });
    const script = document.querySelector<HTMLScriptElement>('script[src*="/widget/widget.js"]');
    expect(script).not.toBeNull();
    expect(script?.async).toBe(true);
    expect(script?.src).toBe('https://assistify.chat/widget/widget.js');
    expect(script?.getAttribute('data-widget-id')).toBe('aaaaaaaaaaaaaaaa');
    expect(script?.hasAttribute('data-assistify-loader')).toBe(true);
  });

  it('does not inject twice for the same widgetId', () => {
    mount({ widgetId: 'aaaaaaaaaaaaaaaa' });
    mount({ widgetId: 'aaaaaaaaaaaaaaaa' });
    const scripts = document.querySelectorAll('script[src*="/widget/widget.js"]');
    expect(scripts.length).toBe(1);
  });

  it('throws when mounted with a different widgetId than the legacy script on the page', () => {
    const legacy = document.createElement('script');
    legacy.src = 'https://assistify.chat/widget/widget.js';
    legacy.setAttribute('data-widget-id', 'aaaaaaaaaaaaaaaa');
    legacy.defer = true;
    document.body.appendChild(legacy);

    expect(() => mount({ widgetId: 'bbbbbbbbbbbbbbbb' })).toThrow(/already on the page/);
    expect(() => mount({ widgetId: 'bbbbbbbbbbbbbbbb' })).toThrow(/widgetId="bbbbbbbbbbbbbbbb"/);
  });

  it('does not inject a second script when a matching legacy snippet is present', () => {
    const legacy = document.createElement('script');
    legacy.src = 'https://assistify.chat/widget/widget.js';
    legacy.setAttribute('data-widget-id', 'aaaaaaaaaaaaaaaa');
    legacy.defer = true;
    document.body.appendChild(legacy);

    mount({ widgetId: 'aaaaaaaaaaaaaaaa' });
    expect(document.querySelectorAll('script[src*="/widget/widget.js"]').length).toBe(1);
  });

  it('honours autoload:false (no script until first call)', () => {
    const handle = mount({ widgetId: 'aaaaaaaaaaaaaaaa', autoload: false });
    expect(document.querySelector('script[src*="/widget/widget.js"]')).toBeNull();
    handle.chat.open();
    expect(document.querySelector('script[src*="/widget/widget.js"]')).not.toBeNull();
  });

  it('writes identity to data-attrs and forwards baseUrl', () => {
    mount({
      widgetId: 'aaaaaaaaaaaaaaaa',
      baseUrl: 'https://example.test',
      identity: {
        email: 'a@b.c',
        externalId: 'ext-1',
        userHash: 'a'.repeat(64),
      },
    });
    const script = document.querySelector<HTMLScriptElement>('script[src*="/widget/widget.js"]')!;
    expect(script.src).toBe('https://example.test/widget/widget.js');
    expect(script.getAttribute('data-user-email')).toBe('a@b.c');
    expect(script.getAttribute('data-user-external-id')).toBe('ext-1');
    expect(script.getAttribute('data-user-hash')).toBe('a'.repeat(64));
  });
});

describe('mount() pre-boot buffer + drain', () => {
  it('queues pre-boot calls locally and drains them through window.Assistify on script.onload', () => {
    const handle = mount({ widgetId: 'aaaaaaaaaaaaaaaa' });
    handle.chat.open();
    handle.context.set({ page: { type: 'product' } });

    const script = document.querySelector<HTMLScriptElement>('script[src*="/widget/widget.js"]')!;
    const loader = installLoaderProxy();
    script.dispatchEvent(new Event('load'));

    const methods = loader._queue.map((c) => c.method);
    expect(methods).toContain('open');
    expect(methods).toContain('setContext');
  });

  it('queues context passed to mount() and replays on drain', () => {
    mount({ widgetId: 'aaaaaaaaaaaaaaaa', context: { page: { path: '/home' } } });
    const script = document.querySelector<HTMLScriptElement>('script[src*="/widget/widget.js"]')!;
    const loader = installLoaderProxy();
    script.dispatchEvent(new Event('load'));

    const setContextCall = loader._queue.find((c) => c.method === 'setContext');
    expect(setContextCall).toBeDefined();
    expect((setContextCall!.args[0] as { page: { path: string } }).page.path).toBe('/home');
  });
});

describe('handle.load()', () => {
  it('rejects with an error when script.onerror fires', async () => {
    const handle = mount({ widgetId: 'aaaaaaaaaaaaaaaa' });
    const loadPromise = handle.load();
    const script = document.querySelector<HTMLScriptElement>('script[src*="/widget/widget.js"]')!;
    script.dispatchEvent(new Event('error'));
    await expect(loadPromise).rejects.toThrow(/failed to load widget\.js/);
  });

  it('returns the same in-flight promise across parallel calls', async () => {
    const handle = mount({ widgetId: 'aaaaaaaaaaaaaaaa' });
    const a = handle.load();
    const b = handle.load();
    expect(a).toBe(b);
    const script = document.querySelector<HTMLScriptElement>('script[src*="/widget/widget.js"]')!;
    script.dispatchEvent(new Event('error'));
    await expect(a).rejects.toThrow();
    await expect(b).rejects.toThrow();
  });

  it('times out after 30s when ready never fires', async () => {
    vi.useFakeTimers();
    try {
      const handle = mount({ widgetId: 'aaaaaaaaaaaaaaaa' });
      const loadPromise = handle.load();
      // Attach a no-op catch so Node does not report an unhandled rejection
      // while the test is awaiting the timer to advance.
      loadPromise.catch(() => { /* asserted below */ });
      const script = document.querySelector<HTMLScriptElement>('script[src*="/widget/widget.js"]')!;
      installLoaderProxy();
      script.dispatchEvent(new Event('load'));
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(loadPromise).rejects.toThrow(/timed out/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('mount() invalid-widgetId detection', () => {
  it('logs an error when widgetId is the documentation placeholder', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => { /* swallow */ });
    try {
      mount({ widgetId: 'YOUR_WIDGET_ID' });
      const messages = spy.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => /placeholder widgetId/.test(m))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('logs an error when widgetId is not 16 lowercase hex chars', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => { /* swallow */ });
    try {
      mount({ widgetId: 'not-a-real-id' });
      const messages = spy.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => /16 lowercase hex/.test(m))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not log when widgetId matches the 16-hex format', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => { /* swallow */ });
    try {
      mount({ widgetId: 'abcdef0123456789' });
      const messages = spy.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => /placeholder|hex/.test(m))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('autoload:false buffer-vs-boot contract', () => {
  it('events.on() does not inject the script', () => {
    const handle = mount({ widgetId: 'aaaaaaaaaaaaaaaa', autoload: false });
    handle.events.on('ready', () => { /* noop */ });
    expect(document.querySelector('script[src*="/widget/widget.js"]')).toBeNull();
  });

  it('context.set() does not inject the script', () => {
    const handle = mount({ widgetId: 'aaaaaaaaaaaaaaaa', autoload: false });
    handle.context.set({ page: { path: '/foo' } });
    expect(document.querySelector('script[src*="/widget/widget.js"]')).toBeNull();
  });

  it('user.identify() does not inject the script', () => {
    const handle = mount({ widgetId: 'aaaaaaaaaaaaaaaa', autoload: false });
    handle.user.identify({ email: 'a@b.c', userHash: 'a'.repeat(64) });
    expect(document.querySelector('script[src*="/widget/widget.js"]')).toBeNull();
  });

  it('identity supplied via user.identify() is baked into data-attrs when boot triggers later', () => {
    const handle = mount({ widgetId: 'aaaaaaaaaaaaaaaa', autoload: false });
    handle.user.identify({ email: 'a@b.c', externalId: 'ext-1', userHash: 'a'.repeat(64) });
    handle.load().catch(() => { /* ignore — no loader installed in this test */ });
    const script = document.querySelector<HTMLScriptElement>('script[src*="/widget/widget.js"]')!;
    expect(script.getAttribute('data-user-email')).toBe('a@b.c');
    expect(script.getAttribute('data-user-external-id')).toBe('ext-1');
    expect(script.getAttribute('data-user-hash')).toBe('a'.repeat(64));
  });

  it('successive user.identify() calls merge top-level keys before script injection', () => {
    const handle = mount({ widgetId: 'aaaaaaaaaaaaaaaa', autoload: false });
    handle.user.identify({ email: 'a@b.c' });
    handle.user.identify({ userHash: 'a'.repeat(64) });
    handle.load().catch(() => { /* ignore */ });
    const script = document.querySelector<HTMLScriptElement>('script[src*="/widget/widget.js"]')!;
    expect(script.getAttribute('data-user-email')).toBe('a@b.c');
    expect(script.getAttribute('data-user-hash')).toBe('a'.repeat(64));
  });

  it('chat.open() triggers boot', () => {
    const handle = mount({ widgetId: 'aaaaaaaaaaaaaaaa', autoload: false });
    handle.chat.open();
    expect(document.querySelector('script[src*="/widget/widget.js"]')).not.toBeNull();
  });

  it('reset() triggers boot', () => {
    const handle = mount({ widgetId: 'aaaaaaaaaaaaaaaa', autoload: false });
    handle.reset();
    expect(document.querySelector('script[src*="/widget/widget.js"]')).not.toBeNull();
  });

  it('pre-boot context.set() and user.identify() reach the runtime after script.onload', () => {
    const handle = mount({ widgetId: 'aaaaaaaaaaaaaaaa', autoload: false });
    handle.events.on('ready', () => { /* noop */ });
    handle.context.set({ page: { type: 'product' } });
    handle.user.identify({ email: 'a@b.c', userHash: 'a'.repeat(64) });
    handle.load().catch(() => { /* ignore */ });

    const script = document.querySelector<HTMLScriptElement>('script[src*="/widget/widget.js"]')!;
    const loader = installLoaderProxy();
    script.dispatchEvent(new Event('load'));

    const methods = loader._queue.map((c) => c.method);
    expect(methods).toContain('on');
    expect(methods).toContain('setContext');
    expect(methods).toContain('identify');
  });
});

describe('mount() race-free pre-boot calls', () => {
  it('does not throw when handle.chat.open() is called in the same tick as mount()', () => {
    const handle = mount({ widgetId: 'aaaaaaaaaaaaaaaa' });
    expect(() => handle.chat.open()).not.toThrow();

    const script = document.querySelector<HTMLScriptElement>('script[src*="/widget/widget.js"]')!;
    const loader = installLoaderProxy();
    script.dispatchEvent(new Event('load'));

    expect(loader._queue.some((c) => c.method === 'open')).toBe(true);
  });
});
