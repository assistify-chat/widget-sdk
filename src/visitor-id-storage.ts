/**
 * Visitor ID storage primitives. Pure reads from cookie + localStorage using
 * the canonical key shape. The SDK reads visitor IDs persisted by the widget
 * runtime; it never mints or writes them. Write logic lives in the runtime
 * served from assistify.chat.
 */

import { VISITOR_ID_PATTERN, type VisitorId } from './types';

/** Canonical localStorage / cookie key for a given widget. */
export function visitorIdStorageKey(widgetId: string): string {
  return `assistify.${widgetId}.vid`;
}

/**
 * Read the persisted visitor ID for a given widget. Cookie first, then
 * localStorage. Returns `null` on miss, on validation failure, or in any
 * environment that lacks `document` / `window.localStorage` (SSR, sandboxed
 * iframes, browsers with storage disabled).
 *
 * Read-only.
 */
export function readVisitorIdFromStorage(widgetId: string): VisitorId | null {
  const key = visitorIdStorageKey(widgetId);
  try {
    if (typeof document !== 'undefined') {
      const prefix = encodeURIComponent(key) + '=';
      for (const part of document.cookie.split(';')) {
        const trimmed = part.trim();
        if (trimmed.startsWith(prefix)) {
          const value = decodeURIComponent(trimmed.slice(prefix.length));
          if (VISITOR_ID_PATTERN.test(value)) return value as VisitorId;
          break;
        }
      }
    }
  } catch {
    /* cookies disabled */
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const value = window.localStorage.getItem(key);
      if (value && VISITOR_ID_PATTERN.test(value)) return value as VisitorId;
    }
  } catch {
    /* private mode / quota */
  }
  return null;
}
