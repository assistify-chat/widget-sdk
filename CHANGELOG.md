# @assistifychat/widget

## 0.2.0

### Minor Changes

- 591441e: Rework deferred-boot semantics, fix identity closure capture, extend context schema.

  - `autoload: false` now buffers `events.on/off`, `context.set/clear`, `user.identify`, `user.getVisitorId`, `destroy`, and `isReady` without injecting the loader script. Boot triggers are explicit: `load()`, `reset()`, `chat.open/close/toggle`.
  - Identity supplied via `mount({ identity })` or `user.identify()` is read at script-injection time, so a deferred boot carries the latest `data-user-*` attributes — fixes the case where post-mount identity was lost to closure capture.
  - Successive `user.identify()` calls shallow-merge top-level fields onto the last-known identity.
  - `reset()` drops the SDK's cached identity and context so a subsequent `user.identify(newUser)` starts from a clean slate.
  - `WidgetContext.order` adds `total`, `currency`, `itemCount`. `WidgetContext.customer` adds `segment`, `createdAt`, `totalSpent`, `currency`.
  - Dispatch is now fully fire-and-forget — `dispatchAsync` is removed. Hosts observe completion through events (`ready`, `identified`, ...).
  - `useAssistify()` warns in development when called with mismatched `widgetId` across components.
  - Docs homepage URL points to `/docs/install/assistify-sdk`.

## 0.1.1

### Patch Changes

- a1cf2c6: Move the SDK to its own repository. Internal restructure: drops the `@assistify/shared-types` workspace dependency, vendors the visitor-id storage helper in-package, and switches type-declarations to native tsdown emission. Public API is unchanged.
