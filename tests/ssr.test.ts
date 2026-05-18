// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { mount } from '../src/mount';

describe('mount() in a non-browser environment', () => {
  it('returns a no-op handle and never throws', async () => {
    const handle = mount({ widgetId: 'demo' });
    expect(handle.isReady()).toBe(false);
    expect(handle.user.getVisitorId()).toBe(null);
    await expect(handle.load()).resolves.toBeUndefined();
    await expect(handle.reset()).resolves.toBeUndefined();
    expect(() => handle.chat.open()).not.toThrow();
    expect(() => handle.chat.close()).not.toThrow();
    expect(() => handle.chat.toggle()).not.toThrow();
    expect(() => handle.context.set({ page: { path: '/x' } })).not.toThrow();
    expect(() => handle.context.clear()).not.toThrow();
    expect(() => handle.destroy()).not.toThrow();
    const unsub = handle.events.on('ready', () => { /* cb */ });
    expect(typeof unsub).toBe('function');
    handle.events.off('ready');
  });

  it('warns once per imperative method call in non-production', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ });
    try {
      const handle = mount({ widgetId: 'demo' });
      handle.chat.open();
      handle.chat.close();
      handle.destroy();
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      spy.mockRestore();
      process.env.NODE_ENV = original;
    }
  });
});
