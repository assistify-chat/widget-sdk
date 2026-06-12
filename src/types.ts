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

export interface WidgetReadyPayload {
  widgetId: string;
}
export interface WidgetOpenPayload {
  source: 'api' | 'launcher';
}
export interface WidgetClosePayload {
  source: 'api' | 'ui' | 'escape';
}
/**
 * Emitted after every `identify()` call, and when the visitor identifies
 * themselves inside the chat (identity form, Discord sign-in).
 *
 * `verified` is `true` when the call supplied a `userHash` that matches the
 * tenant's identity secret. It reports the verdict for that call only, so a
 * broken signing setup surfaces immediately even if the contact was verified
 * earlier (the contact itself is never downgraded). When `false`, the
 * identity is recorded as unverified.
 *
 * `merged` is `true` when the identification attached the session to a
 * Contact that already existed before the call: either an anonymous session
 * landing on a known Contact, or two contact rows collapsing into one.
 * `false` means a brand-new Contact was created.
 */
export interface WidgetIdentifiedPayload {
  verified: boolean;
  merged: boolean;
}

/**
 * Emitted after a contact's email is proved: the visitor clicks the magic
 * link or completes Discord OAuth. `verifiedVia` reports the contact's
 * strongest proof, so it reads `HMAC` when the contact was already
 * HMAC-verified before the event fired. Distinct from `identified` — that
 * fires on claim, this fires on proof. Payload deliberately omits email and
 * contactId to avoid leaking PII to merchant-page scripts.
 */
export interface WidgetVerifiedPayload {
  verifiedVia: 'HMAC' | 'MAGIC_LINK' | 'OAUTH';
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
  verified: WidgetVerifiedPayload;
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
   *
   * Rejects on script load failure (network, CSP, adblocker) or on a 30 s
   * timeout. The runtime's boot lifecycle is the only async operation with
   * clear pass/fail signalling; the other imperative methods return
   * synchronously and fire events on completion (see {@link WidgetEventMap}).
   */
  load(): Promise<void>;
  /**
   * The logout call: wipe the session and start over anonymous.
   *
   * Once the widget is loaded, this clears the session server-side and
   * locally, then re-boots as a fresh anonymous visitor. Fire-and-forget;
   * the next boot fires `'ready'` again, so listen for that event to know
   * reset completed.
   *
   * Before the widget has loaded (`autoload: false` with no boot yet), it
   * only clears the visitor's local storage and does not load the widget,
   * so a logout never triggers network activity or renders the launcher on
   * a page where loading was deferred.
   */
  reset(): void;
  /**
   * Tear down the widget UI. Visitor storage on the host origin is left
   * intact, and the teardown is reversible within the same page session:
   * calling `mount()` again (or any boot-triggering method on the handle)
   * boots the widget back up and the returning visitor is recognized.
   */
  destroy(): void;
  /** `true` once the runtime has booted and acquired a session token. */
  isReady(): boolean;

  chat: {
    open(): void;
    close(): void;
    toggle(): void;
  };

  user: {
    /**
     * Send an identification payload.
     *
     * Fire-and-forget. The runtime emits `'identified'` once the backend has
     * processed the call. Listen for that event to know whether the call was
     * HMAC-verified (`verified: true`) or fell back to unverified
     * (`verified: false`).
     */
    identify(identity: WidgetIdentity): void;
    getVisitorId(): string | null;
  };

  events: {
    /**
     * Subscribe to a widget event. The returned function unsubscribes the
     * callback and works at any point in the lifecycle, including before
     * the widget has booted.
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
