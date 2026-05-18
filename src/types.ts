/**
 * Public SDK type surface.
 *
 * Types live here; the SDK is the single source of truth for its own public
 * contract. The widget runtime served from assistify.chat consumes the same
 * shapes via its own internal copy.
 */

/** JSON-safe value type for dynamic data fields (used by `customAttributes`). */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Anonymous visitor identifier: `anon_` + base62 of a UUID v4 (22 chars). */
export type VisitorId = string;

/** VisitorId format regex. Pinned here and in `visitor-id-storage.ts`. */
export const VISITOR_ID_PATTERN = /^anon_[A-Za-z0-9]{22}$/;

/**
 * Identification payload passed via `mount({ identity })` or
 * `handle.user.identify(...)`.
 *
 * All fields are optional, but at least one of `email`, `externalId`, or
 * `discordId` must be present for the call to result in a Contact link/merge.
 *
 * `userHash` is `HMAC-SHA256(identitySecret, anchor)` computed server-side by
 * the host, where `anchor = email || externalId || discordId` (first
 * non-empty wins). Required in production to prevent identity spoofing.
 */
export interface WidgetIdentity {
  email?: string;
  externalId?: string;
  displayName?: string;
  avatarUrl?: string;
  discordId?: string;
  discordUsername?: string;
  discordAvatar?: string;
  customAttributes?: Record<string, JsonValue>;
  /** HMAC-SHA256(identitySecret, email || externalId || discordId). */
  userHash?: string;
}

/**
 * Merchant-supplied page/order/customer context. The widget runtime's
 * sanitizer enforces primitives in `custom`: arrays, nested objects, and null
 * are dropped before persistence.
 */
export interface WidgetContext {
  page?: { type?: string; id?: string; path?: string };
  customer?: { externalId?: string; plan?: string };
  order?: { id?: string; status?: string };
  custom?: Record<string, string | number | boolean>;
}

export interface WidgetReadyPayload {
  widgetId: string;
}
export interface WidgetOpenPayload {
  source: 'api' | 'launcher' | 'auto';
}
export interface WidgetClosePayload {
  source: 'api' | 'ui' | 'escape';
}
export interface WidgetIdentifiedPayload {
  identified: true;
  merged: boolean;
}
export interface WidgetMessageSentPayload {
  conversationId: string;
  messageId: string;
  senderType: 'visitor';
}
export interface WidgetMessageReceivedPayload {
  conversationId: string;
  messageId: string;
  senderType: 'agent' | 'ai' | 'system';
}
export interface WidgetUnreadChangePayload {
  unreadCount: number;
}

export interface WidgetEventMap {
  ready: WidgetReadyPayload;
  open: WidgetOpenPayload;
  close: WidgetClosePayload;
  identified: WidgetIdentifiedPayload;
  'message:sent': WidgetMessageSentPayload;
  'message:received': WidgetMessageReceivedPayload;
  'unread:change': WidgetUnreadChangePayload;
}

export type WidgetEvent = keyof WidgetEventMap;
export type WidgetEventPayload<E extends WidgetEvent> = WidgetEventMap[E];

/**
 * Options passed to {@link mount}.
 */
export interface MountOptions {
  /**
   * Tenant widget ID provisioned in the Assistify dashboard.
   *
   * @remarks
   * Only one widget per page is supported. `mount()` throws if invoked with a
   * second, different `widgetId` while a script for the first is still on the
   * page (either SDK-injected or pasted from a legacy install snippet).
   */
  widgetId: string;

  /**
   * Override the origin that serves the widget runtime.
   *
   * @default 'https://assistify.chat'
   */
  baseUrl?: string;

  /**
   * If `true` (default), inject the loader script immediately. If `false`,
   * the script is injected on the first call to a method that needs the
   * runtime (or on the first explicit `load()` call).
   *
   * @default true
   */
  autoload?: boolean;

  /**
   * Visitor identity. Every field except `customAttributes` is forwarded to
   * the loader via `data-user-*` attributes so the backend can identify the
   * visitor on the first `/widget/boot` call. `customAttributes` is delivered
   * via a post-boot `identify()` call.
   *
   * @remarks
   * The backend `/widget/boot` route discards identity payloads passed via
   * data-attrs unless `userHash` is present and the HMAC matches the tenant
   * secret. Without `userHash`, the session boots anonymous and you must use
   * `handle.user.identify()` post-boot to record an unverified identity.
   */
  identity?: WidgetIdentity;

  /**
   * Initial visitor/page context. Buffered locally and replayed via
   * `Assistify.setContext()` on first runtime boot.
   */
  context?: WidgetContext;
}

/**
 * Imperative handle returned by {@link mount}. Namespaced so callers do not
 * need to reach into globals. Distinct from the runtime's flat
 * `window.Assistify` surface: this is the SDK's intentionally namespaced
 * facade and exists only in the package.
 */
export interface WidgetHandle {
  /**
   * Inject the loader script if not already injected, and resolve once the
   * runtime fires `'ready'`. Idempotent: repeat calls return the same promise.
   */
  load(): Promise<void>;
  /** Wipe the session server-side and locally, then re-boot. */
  reset(): Promise<void>;
  /** Tear down the runtime; subsequent calls become no-ops. */
  destroy(): void;
  /** `true` once the runtime has booted and acquired a session token. */
  isReady(): boolean;

  chat: {
    open(): void;
    close(): void;
    toggle(): void;
  };

  user: {
    identify(identity: WidgetIdentity): Promise<void>;
    getVisitorId(): string | null;
  };

  context: {
    set(context: WidgetContext): void;
    clear(): void;
  };

  events: {
    /**
     * @remarks
     * The returned unsubscribe function is **inert** when `on()` is called
     * before the `'ready'` event has fired. To cancel a pre-boot subscription,
     * call `handle.events.off(event, callback)` directly.
     */
    on<E extends WidgetEvent>(
      event: E,
      callback: (payload: WidgetEventPayload<E>) => void,
    ): () => void;
    off<E extends WidgetEvent>(
      event: E,
      callback?: (payload: WidgetEventPayload<E>) => void,
    ): void;
  };
}
