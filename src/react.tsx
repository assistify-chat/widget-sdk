/**
 * React subpath: `@assistifychat/widget/react`.
 *
 *   - `AssistifyScript`: RSC-safe declarative `<script>` tag. No client JS.
 *   - `useAssistify`: client-side imperative hook, module-singleton handle.
 */

import * as React from 'react';
import { mount } from './mount';
import type { MountOptions, WidgetHandle, WidgetIdentity } from './types';

const DEFAULT_BASE_URL = 'https://assistify.chat';

interface AssistifyScriptProps {
  widgetId: string;
  baseUrl?: string;
  /**
   * @remarks
   * Every identity field except `customAttributes` is forwarded via
   * `data-user-*` attributes. To deliver `customAttributes`, follow up with
   * a client-side `useAssistify().user.identify({ customAttributes })` call.
   *
   * Server-rendered identity is consumed by the backend `/widget/boot` route.
   * Without a valid `userHash`, the payload is discarded and the visitor boots
   * anonymous. To attach an unverified email, use `useAssistify().user.identify()`
   * on the client instead.
   */
  identity?: WidgetIdentity;
}

/**
 * Render the Assistify loader script declaratively. Safe to drop into a
 * Next.js App Router server component or any framework's root layout.
 *
 * @example
 * ```tsx
 * import { AssistifyScript } from '@assistifychat/widget/react';
 * export default function RootLayout({ children }) {
 *   return <html><body>{children}<AssistifyScript widgetId="WIDGET_ID" /></body></html>;
 * }
 * ```
 */
export function AssistifyScript({
  widgetId,
  baseUrl = DEFAULT_BASE_URL,
  identity,
}: AssistifyScriptProps): React.JSX.Element {
  const src = `${baseUrl.replace(/\/$/, '')}/widget/widget.js`;
  const attrs: Record<string, string | undefined> = {
    'data-widget-id': widgetId,
    'data-user-email': identity?.email,
    'data-user-external-id': identity?.externalId,
    'data-user-discord-id': identity?.discordId,
    'data-user-discord-username': identity?.discordUsername,
    'data-user-discord-avatar': identity?.discordAvatar,
    'data-user-name': identity?.displayName,
    'data-user-avatar': identity?.avatarUrl,
    'data-user-hash': identity?.userHash,
  };
  const cleanAttrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'string' && v.length > 0) cleanAttrs[k] = v;
  }
  return <script async src={src} {...cleanAttrs} />;
}

let singleton: WidgetHandle | null = null;
let capturedWidgetId: string | null = null;

/**
 * Client-side imperative hook. Module-singleton handle.
 *
 * @remarks
 * - First call across the page invokes `mount(opts)`; subsequent calls return
 *   the same handle, even from other components.
 * - Does **not** destroy on unmount. The widget is a page-singleton; tying its
 *   lifecycle to a React component causes destroy/re-mount cycles under React
 *   StrictMode and breaks sibling consumers.
 * - SSR-safe: when `window` is undefined, `mount()` returns a no-op handle.
 * - `opts` is captured on first call only. Changing `opts.widgetId` across
 *   renders does not re-mount; the throw-on-mismatch guard in `mount()`
 *   enforces single-widget per page.
 *
 * @example
 * ```tsx
 * 'use client';
 * import { useAssistify } from '@assistifychat/widget/react';
 * export function SupportButton() {
 *   const widget = useAssistify({ widgetId: 'WIDGET_ID' });
 *   return <button onClick={() => widget.chat.open()}>Need help?</button>;
 * }
 * ```
 */
export function useAssistify(opts: MountOptions): WidgetHandle {
  const [handle] = React.useState<WidgetHandle>(() => {
    if (!singleton) {
      singleton = mount(opts);
      capturedWidgetId = opts.widgetId;
    }
    return singleton;
  });

  // Surface the common typo "two components passed different widgetIds" in
  // development. Stripped from production bundles by every modern bundler's
  // dead-code elimination on `process.env.NODE_ENV`.
  if (
    process.env.NODE_ENV !== 'production' &&
    capturedWidgetId !== null &&
    opts.widgetId !== capturedWidgetId
  ) {
    console.warn(
      '[assistify] useAssistify() called with widgetId="' + opts.widgetId + '" ' +
      'but the widget is already mounted with widgetId="' + capturedWidgetId + '". ' +
      'Only one widget per page is supported; the second call is ignored. ' +
      'Pass the same widgetId everywhere you call it.',
    );
  }

  return handle;
}

/** Test-only escape hatch. */
export function __resetReactSingletonForTests(): void {
  singleton = null;
  capturedWidgetId = null;
}
