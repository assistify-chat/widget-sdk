# @assistifychat/widget

## 1.0.0

First stable release. The 0.x versions were pre-launch previews; this is the supported baseline.

Changes since 0.2.1:

- Removed the visitor-context API (`handle.context.set()/clear()`, `mount({ context })`, the `WidgetContext` type). It was never wired end to end. Per-visitor metadata has a single home: `user.identify({ customAttributes })`. Order and customer data is sourced server-side from the commerce integrations, keyed on a verified contact email.
- `destroy()` is now reversible within the same page session: calling `mount()` again (or any boot-triggering method on the handle) boots the widget back up. Visitor storage is left intact, so the returning visitor is recognized. Previously a destroyed widget could only come back on the next page load.
- New `verified` event (`{ verifiedVia, merged }`), emitted when a claimed email is proved: magic link clicked, OAuth provider verified, HMAC upgrade, or agent attestation. Distinct from `identified`, which fires on claim.
- Corrected the `identified` payload contract: `merged` is `true` whenever the identification attached the session to a pre-existing contact, not only when two contact rows collapsed into one.
- `reset()` followed by `user.identify()` is serialized: the identify is held until the post-reset session boots, so it lands on the new visitor.
- Console guidance points at the real dashboard location (Widget → Settings → Credentials).
