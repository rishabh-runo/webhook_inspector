# Webhook Inspector

A lightweight, real-time webhook inspection tool built with Node.js. It captures incoming HTTP requests (Vonage, Stripe, GitHub, anything), keeps them in memory, and streams them live to a browser dashboard over WebSocket.

Intended for local development and debugging. Logs and custom channels live in memory and are wiped on restart.

---

## Features

**Capturing**
- Any HTTP method, any content type: JSON, form, text, XML, binary (stored as base64)
- Raw body kept exactly as received (needed for signature checks)
- Sub-paths are captured too: `/hook/<channel>/anything/here`
- Per-log size, duration, source IP, response headers and body

**Channels**
- Built-in `open` (no auth) and `secure` (`auth-key` = `AUTH_KEY`). These are fixed: they can't be edited or deleted.
- Chrome-style tab bar: `+` creates a channel, `×` (or middle-click, or `Delete` on a focused tab) deletes one. You're asked to confirm only if the channel has logs.
- Create, edit and delete channels from the UI, each with its own:
  - optional password: only people who enter it can see the channel's logs or change its settings
  - optional `auth-key`
  - custom response: status, headers, body, delay (0-30 s)
  - signature check: Vonage JWT, Stripe, GitHub, or generic HMAC SHA-256
- Signature results show on each log as `✓ signed` / `✗ signature` (hover for the reason). Requests are never rejected for a bad signature, only labelled.

**Dashboard**
- Live feed with auto-reconnect and a Live / Reconnecting / Disconnected indicator
- Pause and resume the live feed per channel (⏸ on the tab); held requests show on resume
- Search (url, headers, body, response) and filters (method, status, time range, starred)
- Collapsible, syntax-coloured JSON viewer
- Copy endpoint URL, any section, or a whole request as cURL
- Star logs: starred logs survive Clear and the log cap
- Compare two logs side by side (diff)
- Export JSON or HAR; import JSON exports or HAR files
- Light / dark theme (follows system by default), works on phones
- Per-channel desktop notification and/or sound (off by default). Alerts fire for enabled channels only, and not while you're already looking at that channel. Saved per browser.
- Keyboard shortcuts (press `?`)
- Renders 50 cards at a time and loads more on scroll; new logs are inserted without re-rendering the list

---

## Project Structure

```
webhook_inspector/
├── index.js              # Express + WebSocket server, routes, channel store
├── lib/
│   ├── signature.js      # Vonage / Stripe / GitHub / HMAC verification
│   └── validate.js       # Channel config validation, import sanitizing, header masking
├── public/
│   ├── index.html        # Dashboard markup
│   ├── css/app.css       # Styles + light/dark theme tokens
│   └── js/
│       ├── main.js       # State, list rendering, events, keyboard shortcuts
│       ├── api.js        # fetch wrapper, channel access tokens, WebSocket URL
│       ├── ws.js         # WebSocket with backoff reconnect
│       ├── render.js     # Log card + section rendering
│       ├── json-view.js  # Collapsible JSON tree
│       ├── channels.js   # Create / edit channel dialog
│       ├── diff.js       # Side-by-side diff
│       ├── export.js     # JSON / HAR export and import parsing
│       ├── notify.js     # Notifications, sound, unread title count
│       └── utils.js      # Escaping, formatting, clipboard, cURL builder
└── package.json
```

No build step: the browser loads the JS files as ES modules.

---

## Environment Variables

Create a `.env` file in the project root:

```env
AUTH_KEY=your_secret_key_here
```

| Variable | Used as | Default |
|---|---|---|
| `AUTH_KEY` | `auth-key` header required by `/hook/secure` (unset = all rejected) | none |
| `PORT` | HTTP/WS port | `3000` |
| `MAX_LOGS` | Max logs kept per channel (oldest unstarred dropped) | `500` |
| `MAX_CHANNELS` | Max number of channels | `50` |
| `BODY_LIMIT` | Max request body size | `10mb` |
| `TRUST_PROXY` | Express `trust proxy` setting, so the logged IP is the real client behind ngrok / a proxy (`true`, a hop count, or a subnet) | unset |

Sensitive headers (`auth-key`, `channel-token`, `authorization`, `cookie`) are masked as `***` in logs. Signatures are checked before masking.

---

## Channel Passwords

The dashboard is open to everyone. To keep a channel private, set a password in its **⚙ Settings**.

- Everyone still sees the channel's name and webhook URL in the tab bar.
- Without the password, the channel shows a lock screen: no logs, no live updates, no settings, no delete.
- After unlocking, this browser remembers it (🔓 on the tab). **🔒 Lock** forgets it.
- Changing or removing the password logs everyone else out of that channel.
- Webhook senders don't need the password (use `auth-key` for that).
- Built-in `open` and `secure` can't have a password.

How it works: the password is hashed with scrypt (never stored in plain text). Unlocking returns an HMAC access token for that channel, sent as the `channel-token` header and in the WebSocket `AUTH` message. Tokens stop working when the password changes or the server restarts. 10 wrong passwords from one IP lock unlocking for 10 minutes.

> **Security note:** channels without a password can be viewed, edited and deleted by anyone who can reach the server. Protect any channel that matters, and use HTTPS when the server is exposed.

---

## Running the Server

```bash
npm install
npm start
```

Open **http://localhost:3000** (or your `PORT`).

---

## Webhook Endpoints

### `ALL /hook/:channel` and `ALL /hook/:channel/*`

| | |
|---|---|
| Auth | `auth-key` header, only if the channel requires it |
| Response | The channel's custom response (default `200 {"status":"OK"}`) |
| Unknown channel | `404`, not logged |
| CORS | Enabled (only on `/hook/*`) |

```bash
curl -X POST http://localhost:3000/hook/secure \
  -H "auth-key: $AUTH_KEY" \
  -H "Content-Type: application/json" \
  -d '{"event":"sms","text":"Hello"}'
```

### Signature checks

| Type | Default header | What is checked |
|---|---|---|
| `vonage` | `authorization` | `Bearer <JWT>` signed HS256 with the signature secret; `payload_hash` must equal sha256 of the raw body |
| `stripe` | `stripe-signature` | `v1` = HMAC-SHA256 of `<t>.<raw body>`; timestamp within 5 min |
| `github` | `x-hub-signature-256` | `sha256=` + HMAC-SHA256 hex of the raw body |
| `hmac-sha256` | `x-signature` | HMAC-SHA256 of the raw body, hex or base64, optional `sha256=` prefix |

The header name can be changed per channel.

---

## Dashboard API

No login. Routes for a password-protected channel need its `channel-token` header, otherwise they return `403 { locked: true }`.

### Channels

| Method | Path | Body | Notes |
|---|---|---|---|
| `GET` | `/api/channels` | | Public list. Secrets are never returned, only `hasAuthKey` / `hasSecret` / `locked` |
| `POST` | `/api/channels` | channel config | `id` optional (random if empty). Returns a `token` if a password was set |
| `POST` | `/api/channels/:id/unlock` | `{ "password": "..." }` | Returns `{ token }`. `429` after 10 wrong tries |
| `PATCH` | `/api/channels/:id` | partial config | Needs token if protected. Omitted fields stay unchanged. Built-in channels can't be changed |
| `DELETE` | `/api/channels/:id` | | Needs token if protected. Built-in channels can't be deleted |

Channel config:

```json
{
  "id": "my-service",
  "name": "My service",
  "viewPassword": "at least 4 chars",
  "authKey": "secret",
  "response": { "status": 200, "headers": { "x-foo": "bar" }, "body": "{\"ok\":true}", "delayMs": 0 },
  "signature": { "type": "stripe", "header": "", "secret": "whsec_..." }
}
```

`viewPassword: ""` removes the password. `authKey: ""` turns auth off. `signature.secret` omitted keeps the current secret.

### Logs

| Method | Path | Body | Notes |
|---|---|---|---|
| `GET` | `/logs/:channel` | | Newest first |
| `DELETE` | `/logs/:channel` | | Clears unstarred logs |
| `DELETE` | `/logs/:channel/:id` | | Deletes one log |
| `PATCH` | `/logs/:channel/:id` | `{ "pinned": true }` | Star / unstar |
| `POST` | `/logs/:channel/import` | `{ "logs": [...] }` | Max 500 per call; entries are sanitized and marked `imported` |

### Log object

```js
{
  id, channel, method, url, ip,
  headers,          // sensitive ones masked
  query,
  contentType,
  body,             // parsed JSON / form object, text, or null
  rawBody,          // exactly as received (base64 if binary)
  rawEncoding,      // 'utf8' | 'base64'
  size,             // bytes
  response, responseHeaders, status,
  time, duration, aborted,
  signature,        // null or { type, header, valid, reason }
  pinned
}
```

---

## WebSocket Protocol

Connect to the same host/port (`ws://localhost:3000/`). To receive protected channels, send `{ "type": "AUTH", "tokens": { "<channelId>": "<token>" } }` after connecting (and again whenever tokens change). Channel-scoped messages for a protected channel only go to clients holding its token. Messages:

| `type` | Payload |
|---|---|
| `NEW_LOG` | `channel`, `data` (log), `dropped` (ids removed by the cap) |
| `UPDATE_LOG` | `channel`, `data` (log) |
| `DELETE_LOG` | `channel`, `id` |
| `CLEAR_LOGS` | `channel` (starred logs remain) |
| `RELOAD_CHANNEL` | `channel` (refetch after an import) |
| `CHANNEL_UPSERT` | `data` (public channel) |
| `CHANNEL_DELETE` | `id` |

After a reconnect the dashboard refetches everything, so missed events are not lost.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `j` / `k` | Next / previous log |
| `o` or `Enter` | Expand / collapse |
| `c` | Copy as cURL |
| `s` | Star / unstar |
| `x` | Select for compare |
| `/` | Search |
| `p` | Pause / resume this channel |
| `[` / `]` | Previous / next channel |
| `n` / `m` | Notification / sound for this channel |
| `t` | Toggle theme |
| `?` | Help |
| `Esc` | Close dialog / clear selection |

---

## Using with Vonage

1. Expose the server publicly, e.g. `ngrok http 3000` (and set `TRUST_PROXY=true` to log real IPs).
2. Create a channel (e.g. `vonage`) and point your Vonage application's answer/event URLs at `https://<ngrok-id>.ngrok.io/hook/vonage/answer` and `.../hook/vonage/event`.
3. For signed webhooks, set the channel's signature type to **Vonage (JWT)** and paste your account's signature secret.
4. Use the custom response to return NCCO JSON for answer URLs, or a delay / 5xx to test Vonage retries.

---

## Where Data Lives

| Data | Stored in | Shared? |
|---|---|---|
| Channels (config, auth keys, signing secrets, password hashes) | Server memory (`channels` Map in `index.js`) | Channel list is visible to everyone |
| Captured logs | Server memory, inside each channel | Everyone, unless the channel has a password |
| Theme, channel access tokens, alert prefs | Browser `localStorage` | Per browser |

Restarting the server wipes channels and logs. Secrets never leave the server: the dashboard only sees `hasAuthKey` / `hasSecret`.

---

## Limitations

| Limitation | Detail |
|---|---|
| No persistence | Logs and custom channels live in memory; wiped on restart |
| Single process | No support for multiple instances sharing logs |
| No HTTPS | Wrap with a proxy / ngrok when exposed |
| No rate limiting | No throttle on `/hook/*` |

---

## Credits

© 2026 Webhook Inspector · Built by **Rishabh @ Runo**
