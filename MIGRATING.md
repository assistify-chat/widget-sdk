# Migration Guide

## 0.x → 1.0

The 0.x line was a pre-launch preview. Three changes affect code written against it:

- The visitor-context API is gone: `handle.context.set()/clear()`, `mount({ context })`, and the `WidgetContext` type. Send per-visitor metadata through `user.identify({ customAttributes })` instead; order and customer data is sourced server-side from the commerce integrations.
- `destroy()` is no longer terminal for the page session. A later `mount()` (or any boot-triggering call on the handle) re-boots the widget. If you relied on destroy being permanent, gate the re-mount in your own code.
- The event map gains `verified` (`{ verifiedVia, merged }`), fired when a claimed email is proved. Purely additive.
