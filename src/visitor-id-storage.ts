/**
 * Visitor ID storage primitives. Reads from cookie + localStorage using the
 * canonical key shape. The SDK never mints or writes visitor IDs; minting
 * and persistence live in the runtime served from assistify.chat. The one
 * mutation the SDK performs is `clearVisitorIdFromStorage`, used by a
 * pre-load `reset()` so logout works without loading the widget.
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

/**
 * Remove the visitor ID from cookie, localStorage and sessionStorage.
 *
 * Used by `reset()` when the widget has not been loaded on the page:
 * logout must still clear local recognition so the next person on this
 * browser starts unrecognized. The cookie removal attributes mirror the
 * ones the runtime writes with (Path=/, SameSite=Lax).
 */
export function clearVisitorIdFromStorage(widgetId: string): void {
  const key = visitorIdStorageKey(widgetId);
  try {
    if (typeof document !== 'undefined') {
      document.cookie = `${encodeURIComponent(key)}=; Max-Age=0; Path=/; SameSite=Lax`;
    }
  } catch {
    /* cookies disabled */
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  } catch {
    /* private mode / quota */
  }
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    /* private mode / quota */
  }
}
