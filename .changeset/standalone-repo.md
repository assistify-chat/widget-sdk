---
"@assistifychat/widget": patch
---

Move the SDK to its own repository. Internal restructure: drops the `@assistify/shared-types` workspace dependency, vendors the visitor-id storage helper in-package, and switches type-declarations to native tsdown emission. Public API is unchanged.
