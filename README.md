# @assistifychat/widget

Embed the Assistify chat widget on your site with full TypeScript support.

[![npm](https://img.shields.io/npm/v/@assistifychat/widget.svg)](https://www.npmjs.com/package/@assistifychat/widget)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@assistifychat/widget)](https://bundlephobia.com/package/@assistifychat/widget)
[![license](https://img.shields.io/npm/l/@assistifychat/widget.svg)](./LICENSE)

## Install

```sh
npm  i @assistifychat/widget
pnpm add @assistifychat/widget
yarn add @assistifychat/widget
```

No required dependencies. React is an optional peer used only when you import the `/react` subpath.

## Quickstart

```ts
import { mount } from '@assistifychat/widget';

const widget = mount({ widgetId: 'YOUR_WIDGET_ID' });
widget.events.on('ready', () => console.log('Assistify ready'));
document.getElementById('chat-btn')?.addEventListener('click', () => widget.chat.open());
```

`mount()` returns the handle synchronously. Methods called before the runtime has booted are buffered and replayed once it is ready.

To defer the network request, set `autoload: false` and call `widget.load()` later:

```ts
const widget = mount({ widgetId: 'YOUR_WIDGET_ID', autoload: false });
await widget.load();
widget.chat.open();
```

## Single widget per page

Only one widget runs per page. `mount()` throws if you pass a `widgetId` that does not match an existing widget script already on the page. For micro-frontend setups, configure every shell with the same `widgetId`; each `mount()` after the first returns a handle wired to the existing runtime.

## React

The package ships a React entry point at `@assistifychat/widget/react`.

### Server component

```tsx
import { AssistifyScript } from '@assistifychat/widget/react';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <AssistifyScript widgetId="YOUR_WIDGET_ID" />
      </body>
    </html>
  );
}
```

`AssistifyScript` renders the loader as a `<script>` tag. RSC-safe; no client JS ships.

### Client component

```tsx
'use client';
import { useAssistify } from '@assistifychat/widget/react';

export function SupportButton() {
  const widget = useAssistify({ widgetId: 'YOUR_WIDGET_ID' });
  return <button onClick={() => widget.chat.open()}>Need help?</button>;
}
```

`useAssistify` returns the same handle on every call. The widget is a page-level singleton and is not torn down on unmount.

There is no `/vue`, `/svelte`, or `/angular` subpath. Those frameworks can emit the `<script>` tag through their template syntax directly.

## Identity verification

The package never computes `userHash`. Compute it on your backend as `HMAC-SHA256(identitySecret, email || externalId || discordId)` and pass the hex digest as `userHash`.

```js
import { createHmac } from 'node:crypto';

const userHash = createHmac('sha256', identitySecret).update(email).digest('hex');
```

Examples in Node, Python, PHP, Ruby, and Go: <https://assistify.chat/docs/integration/identity-verification>.

## Server-rendered vs imperative identity

| Path | `userHash` | Result |
| --- | --- | --- |
| `<AssistifyScript identity={{ email, userHash }} />` | required | Recorded as HMAC-verified at boot. |
| `<AssistifyScript identity={{ email }} />` | missing | Discarded. Session boots anonymous. |
| `handle.user.identify({ email })` | optional | Recorded as unverified. |
| `handle.user.identify({ email, userHash })` | present | Recorded as HMAC-verified. |

Rule of thumb: server-rendered identity requires HMAC; imperative identity does not.

## Content Security Policy

Hosts must allow:

```
script-src  https://assistify.chat;
connect-src https://assistify.chat wss://assistify.chat;
img-src     https://assistify.chat data:;
```

## Docs

Full API reference: <https://assistify.chat/docs/integration/npm-package>.
