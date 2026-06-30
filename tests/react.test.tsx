/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AssistifyScript, useAssistify, __resetReactSingletonForTests } from '../src/react';
import type { WidgetHandle } from '../src/types';

function html(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe('<AssistifyScript />', () => {
  it('renders one async script with widgetId', () => {
    const out = html(<AssistifyScript widgetId="aaaaaaaaaaaaaaaa" />);
    expect(out).toMatch(/<script[^>]*src="https:\/\/assistify\.chat\/widget\/widget\.js"/);
    expect(out).toMatch(/data-widget-id="aaaaaaaaaaaaaaaa"/);
  });

  it('emits every identity data-attr except customAttributes', () => {
    const out = html(
      <AssistifyScript
        widgetId="aaaaaaaaaaaaaaaa"
        identity={{
          email: 'a@b.c',
          userHash: 'h'.repeat(64),
          avatarUrl: 'https://cdn/u.png',
          discordUsername: 'foo',
          discordAvatar: 'https://cdn/d.png',
          customAttributes: { plan: 'pro' },
        }}
      />,
    );
    expect(out).toContain('data-user-email="a@b.c"');
    expect(out).toContain('data-user-avatar="https://cdn/u.png"');
    expect(out).toContain('data-user-discord-username="foo"');
    expect(out).toContain('data-user-discord-avatar="https://cdn/d.png"');
    expect(out).toContain('data-user-hash="' + 'h'.repeat(64) + '"');
    expect(out).not.toMatch(/data-user-custom/);
  });

  it('omits data-launcher by default and emits it only for launcher={false}', () => {
    expect(html(<AssistifyScript widgetId="aaaaaaaaaaaaaaaa" />)).not.toMatch(/data-launcher/);
    expect(html(<AssistifyScript widgetId="aaaaaaaaaaaaaaaa" launcher />)).not.toMatch(/data-launcher/);
    expect(html(<AssistifyScript widgetId="aaaaaaaaaaaaaaaa" launcher={false} />)).toContain(
      'data-launcher="false"',
    );
  });
});

describe('useAssistify', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  function captureHandles(): WidgetHandle[] {
    const handles: WidgetHandle[] = [];
    function A(): React.ReactElement {
      const h = useAssistify({ widgetId: 'aaaaaaaaaaaaaaaa' });
      handles.push(h);
      return <span />;
    }
    function B(): React.ReactElement {
      const h = useAssistify({ widgetId: 'aaaaaaaaaaaaaaaa' });
      handles.push(h);
      return <span />;
    }
    act(() => {
      root.render(
        <>
          <A />
          <B />
        </>,
      );
    });
    return handles;
  }

  it('returns the same singleton handle across sibling components', () => {
    const [a, b] = captureHandles();
    expect(a).toBe(b);
  });

  it('survives unmount + remount as the same singleton', () => {
    const [a] = captureHandles();
    act(() => {
      root.unmount();
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const [c] = captureHandles();
    expect(c).toBe(a);
  });

  it('warns in development when a second call passes a different widgetId', () => {
    __resetReactSingletonForTests();
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ });
    function A(): React.ReactElement {
      useAssistify({ widgetId: 'aaaaaaaaaaaaaaaa' });
      return <span />;
    }
    function B(): React.ReactElement {
      useAssistify({ widgetId: 'bbbbbbbbbbbbbbbb' });
      return <span />;
    }
    try {
      act(() => {
        root.render(<><A /><B /></>);
      });
      const warnings = spy.mock.calls.map((c) => String(c[0]));
      expect(warnings.some((w) => /widgetId="bbbbbbbbbbbbbbbb"/.test(w))).toBe(true);
      expect(warnings.some((w) => /already mounted/.test(w))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
