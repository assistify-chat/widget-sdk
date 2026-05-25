---
"@assistifychat/widget": patch
---

`user.identify()` calls made between `reset()` and the next `'ready'` event are now held until the post-reset session is live, so the back-to-back `reset(); identify(newUser);` pattern lands the identity on the new visitor instead of racing the session that's being torn down. `destroy()` also clears any pending reset state.
