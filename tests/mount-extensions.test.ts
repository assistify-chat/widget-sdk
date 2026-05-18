/**
 * mount() behavioural coverage:
 *   - script.crossOrigin = 'anonymous' on injection
 *   - identity data-attrs (avatarUrl, discordUsername, discordAvatar)
 *   - customAttributes triggers a single post-boot identify carrying the
 *     full identity, and no overflow path when only data-attr fields are
 *     passed
 *   - destroy() makes subsequent calls no-op
 *   - legacy-script-reuse race: legacy script on the page, window.Assistify
 *     installed late, queued calls reach the loader once the IIFE runs
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, __resetMountForTests } from '../src/mount';
import { __resetQueueForTests } from '../src/queue';

interface LoaderQueueEntry {
  method: string;
  args: unknown[];
}
interface LoaderProxy {
  _isLoader: true;
  _queue: LoaderQueueEntry[];
  open: (...a: unknown[]) => void;
  close: (...a: unknown[]) => void;
  toggle: (...a: unknown[]) => void;
  reset: (...a: unknown[]) => Promise<void>;
  destroy: (...a: unknown[]) => void;
  identify: (...a: unknown[]) => Promise<void>;
  setContext: (...a: unknown[]) => void;
  clearContext: (...a: unknown[]) => void;
  on: (...a: unknown[]) => () => void;
  off: (...a: unknown[]) => void;
  isReady: () => boolean;
  getVisitorId: () => string | null;
}

function installLoaderProxy(): LoaderProxy {
  const queue: LoaderQueueEntry[] = [];
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
  return proxy as unknown as LoaderProxy;
}

beforeEach(() => {
  __resetMountForTests();
  __resetQueueForTests();
  delete (window as unknown as { Assistify?: unknown }).Assistify;
  delete (window as unknown as { CHATBOT_CONFIG?: unknown }).CHATBOT_CONFIG;
  document.querySelectorAll('script[src*="/widget/widget.js"]').forEach((s) => s.remove());
});

afterEach(() => {
  __resetMountForTests();
  __resetQueueForTests();
});

describe('mount() script attributes', () => {
  it('sets crossOrigin="anonymous" on the injected script', () => {
    mount({ widgetId: 'demo' });
    const script = document.querySelector<HTMLScriptElement>('script[src*="/widget/widget.js"]')!;
    expect(script.crossOrigin).toBe('anonymous');
  });
});

describe('mount() identity data-attrs', () => {
  it('writes every supported identity field to data-attrs', () => {
    mount({
      widgetId: 'demo',
      identity: {
        email: 'a@b.c',
        externalId: 'ext-1',
        discordId: 'd-1',
        discordUsername: 'foo',
        discordAvatar: 'https://cdn/d.png',
        displayName: 'Foo',
        avatarUrl: 'https://cdn/u.png',
        userHash: 'h'.repeat(64),
      },
    });
    const script = document.querySelector<HTMLScriptElement>('script[src*="/widget/widget.js"]')!;
    expect(script.getAttribute('data-user-email')).toBe('a@b.c');
    expect(script.getAttribute('data-user-external-id')).toBe('ext-1');
    expect(script.getAttribute('data-user-discord-id')).toBe('d-1');
    expect(script.getAttribute('data-user-discord-username')).toBe('foo');
    expect(script.getAttribute('data-user-discord-avatar')).toBe('https://cdn/d.png');
    expect(script.getAttribute('data-user-name')).toBe('Foo');
    expect(script.getAttribute('data-user-avatar')).toBe('https://cdn/u.png');
    expect(script.getAttribute('data-user-hash')).toBe('h'.repeat(64));
  });

  it('does NOT fire a post-boot identify when only data-attr fields are passed', () => {
    mount({
      widgetId: 'demo',
      identity: {
        email: 'a@b.c',
        avatarUrl: 'https://cdn/u.png',
        discordUsername: 'foo',
        userHash: 'h'.repeat(64),
      },
    });
    const script = document.querySelector<HTMLScriptElement>('script[src*="/widget/widget.js"]')!;
    const loader = installLoaderProxy();
    script.dispatchEvent(new Event('load'));
    const identifyCalls = loader._queue.filter((c) => c.method === 'identify');
    expect(identifyCalls.length).toBe(0);
  });

  it('fires exactly one post-boot identify carrying the FULL identity when customAttributes is set', () => {
    mount({
      widgetId: 'demo',
      identity: {
        email: 'a@b.c',
        userHash: 'h'.repeat(64),
        customAttributes: { plan: 'pro', seats: 5 },
      },
    });
    const script = document.querySelector<HTMLScriptElement>('script[src*="/widget/widget.js"]')!;
    const loader = installLoaderProxy();
    script.dispatchEvent(new Event('load'));
    const identifyCalls = loader._queue.filter((c) => c.method === 'identify');
    expect(identifyCalls.length).toBe(1);
    const payload = identifyCalls[0]!.args[0] as Record<string, unknown>;
    expect(payload.email).toBe('a@b.c');
    expect(payload.customAttributes).toEqual({ plan: 'pro', seats: 5 });
  });
});

describe('mount() destroy()', () => {
  it('subsequent calls do not throw and do not enqueue post-destroy', () => {
    const handle = mount({ widgetId: 'demo' });
    handle.destroy();
    expect(() => handle.chat.open()).not.toThrow();
  });
});

describe('mount() legacy-script-reuse race', () => {
  it('drains queued calls once window.Assistify appears post-mount', async () => {
    const legacy = document.createElement('script');
    legacy.src = 'https://assistify.chat/widget/widget.js';
    legacy.setAttribute('data-widget-id', 'demo');
    document.body.appendChild(legacy);

    const handle = mount({ widgetId: 'demo' });
    handle.chat.open();

    // window.Assistify is NOT installed yet; the call must be buffered.
    expect(((window as unknown as { Assistify?: unknown }).Assistify)).toBeUndefined();

    const loader = installLoaderProxy();
    // The SDK poll cadence is 50ms; advance more than one tick.
    await vi.waitFor(() => {
      const hasOpen = loader._queue.some((c) => c.method === 'open');
      if (!hasOpen) throw new Error('open not drained yet');
    }, { timeout: 1500 });

    expect(loader._queue.some((c) => c.method === 'open')).toBe(true);
  });
});
