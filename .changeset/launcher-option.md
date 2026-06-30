---
"@assistifychat/widget": minor
---

Add a `launcher` option for panel-only embeds.

Set `launcher: false` on `mount()` or `<AssistifyScript>` to render the chat panel without the floating launcher, then open it from your own UI with `widget.chat.open()`. Defaults to `true`.
