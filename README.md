# Webhook Inspector

A self-hosted tool to **catch, inspect and debug webhooks** in real time.

Point any service (Vonage, Stripe, GitHub, Twilio, your own app) at a Webhook Inspector URL and every request it sends is captured in full: method, headers, query, body, raw body, sender IP and timing. Logs stream live to the dashboard the moment they arrive.

Built with Node.js, Express and WebSockets. No database: everything lives in memory.

---

## Features

- **Catch any request**: any HTTP method, any content type (JSON, form, text, XML, binary). The raw body is kept exactly as received.
- **Channels**: separate webhook URLs (`/hook/<channel>`), each with its own logs and settings. Sub-paths are captured too (`/hook/<channel>/any/path`).
- **Custom responses**: choose the status code, headers, body and an optional delay (up to 30 s) each channel replies with. Useful for testing retries, timeouts and error handling.
- **Sender authentication**: optionally require an `auth-key` header; requests without it get `401`.
- **Signature verification**: check Vonage (JWT), Stripe, GitHub or generic HMAC SHA-256 signatures. Each log is marked valid or invalid with the reason.
- **Channel passwords**: protect a channel so only people with the password can view its logs or change its settings.
- **Live updates**: new logs are pushed to every open dashboard over WebSocket.
- **Search and filter**: by text, method, status class and time range; star important logs.
- **Replay and share**: copy any request as a cURL command, export logs as JSON or HAR, import them elsewhere, compare two requests side by side.
- **Alerts**: optional desktop notification or sound per channel.
- **Safe by default**: sensitive headers are masked in logs, secrets are never sent to the browser, CORS is limited to webhook endpoints.

---

## Requirements

- Node.js 18 or newer
- npm

---

## Quick start

```bash
git clone https://github.com/rishabh-runo/webhook_inspector.git
cd webhook_inspector
npm install
```

Create a `.env` file in the project root (optional, see [Configuration](#configuration)):

```env
AUTH_KEY=change-me
```

Start the server:

```bash
npm start
```

Open **http://localhost:3000** to see the dashboard, then send a test webhook:

```bash
curl -X POST http://localhost:3000/hook/open \
  -H "Content-Type: application/json" \
  -d '{"event":"test","message":"hello"}'
```

The request shows up in the dashboard immediately.

---

## How to use

### 1. Pick or create a channel

Two channels always exist:

| Channel | URL | Auth |
|---|---|---|
| `open` | `/hook/open` | None, accepts everything |
| `secure` | `/hook/secure` | Requires `auth-key: <AUTH_KEY>` header. If `AUTH_KEY` is not set, every request is rejected |

Create your own channels from the dashboard or the [API](#channels-api). Each gets its own URL, for example `/hook/stripe-prod`.

### 2. Point your service at it

Use the channel URL as the webhook / callback URL in your provider's settings:

```
https://<your-host>/hook/<channel-id>
```

For local development, expose the server with a tunnel such as ngrok:

```bash
ngrok http 3000
```

Then use `https://<ngrok-id>.ngrok.io/hook/<channel-id>` and set `TRUST_PROXY=true` so the real sender IP is logged.

### 3. Send requests and inspect them

Every request to the channel is logged with:

- method, full URL and query parameters
- all headers (secrets masked as `***`)
- parsed body and raw body (base64 for binary)
- the response that was sent back, status code and duration
- sender IP, body size and signature result

### 4. Control what the sender gets back

In a channel's settings, set:

| Setting | Example | Use it to |
|---|---|---|
| Status | `500` | Test how the sender handles errors |
| Delay | `5000` ms | Test timeouts and retries |
| Headers | `x-request-id: 123` | Return headers the sender expects |
| Body | `{"ok":true}` or an NCCO for Vonage | Return the payload the sender expects |

The default reply is `200 {"status":"OK"}`.

### 5. Verify signatures

Choose a signature type and paste the signing secret in the channel settings:

| Type | Header checked (default) | What is verified |
|---|---|---|
| Vonage | `authorization` | `Bearer <JWT>` signed HS256 with your signature secret; `payload_hash` matches the body |
| Stripe | `stripe-signature` | `v1` HMAC-SHA256 of `<timestamp>.<body>`, timestamp within 5 minutes |
| GitHub | `x-hub-signature-256` | `sha256=` HMAC-SHA256 of the body |
| HMAC SHA-256 | `x-signature` | HMAC-SHA256 of the body, hex or base64, optional `sha256=` prefix |

The header name can be changed per channel. Requests with a bad signature are still accepted and logged, just marked invalid, so you can see what went wrong.

### 6. Keep a channel private

Set a password on a channel. Without it, others can see the channel exists but not its logs, and cannot change or delete it. Senders never need the password (use `auth-key` to restrict who can send).

Passwords are hashed with scrypt. 10 wrong attempts from one IP block unlocking for 10 minutes.

---

## Example: Vonage

1. Run the server and expose it with ngrok.
2. Create a channel called `vonage`.
3. In your Vonage application, set the event URL to `https://<ngrok-id>.ngrok.io/hook/vonage/event` and the answer URL to `.../hook/vonage/answer`.
4. To check signed webhooks, set the channel's signature type to **Vonage** and paste your account's signature secret.
5. To answer calls, set the channel's response body to your NCCO JSON.

---

## Configuration

All settings are optional environment variables (put them in `.env`):

| Variable | Description | Default |
|---|---|---|
| `AUTH_KEY` | Key required in the `auth-key` header for `/hook/secure` | not set (rejects all) |
| `PORT` | Port for the HTTP and WebSocket server | `3000` |
| `MAX_LOGS` | Logs kept per channel; oldest unstarred logs are dropped first | `500` |
| `MAX_CHANNELS` | Maximum number of channels | `50` |
| `BODY_LIMIT` | Maximum request body size | `10mb` |
| `TRUST_PROXY` | Express `trust proxy` setting (`true`, a hop count or a subnet) to log the real client IP behind a proxy | not set |

---

## API

Everything the dashboard does is available over HTTP. Routes for a password-protected channel need a `channel-token` header (from the unlock endpoint), otherwise they return `403`.

### Webhook endpoint

| Method | Path | Description |
|---|---|---|
| any | `/hook/:channel` | Capture a request and reply with the channel's configured response |
| any | `/hook/:channel/*` | Same, for any sub-path |

Returns `404` for an unknown channel and `401` when the channel requires an `auth-key` and it is missing or wrong.

### Channels API

| Method | Path | Body | Description |
|---|---|---|---|
| `GET` | `/api/channels` | | List channels (secrets are never returned) |
| `POST` | `/api/channels` | channel config | Create a channel. `id` is optional (random if empty) |
| `PATCH` | `/api/channels/:id` | partial config | Update a channel. Omitted fields stay unchanged |
| `DELETE` | `/api/channels/:id` | | Delete a channel and its logs |
| `POST` | `/api/channels/:id/unlock` | `{ "password": "..." }` | Get a `token` for a password-protected channel |

The built-in `open` and `secure` channels cannot be changed or deleted.

Channel config:

```json
{
  "id": "my-service",
  "name": "My service",
  "viewPassword": "at least 4 characters",
  "authKey": "sender-secret",
  "response": {
    "status": 200,
    "headers": { "x-foo": "bar" },
    "body": "{\"ok\":true}",
    "delayMs": 0
  },
  "signature": { "type": "stripe", "header": "", "secret": "whsec_..." }
}
```

- `viewPassword: ""` removes the password, `authKey: ""` turns sender auth off.
- `signature.type` is one of `none`, `vonage`, `stripe`, `github`, `hmac-sha256`. Omit `signature.secret` to keep the current one.

Example:

```bash
curl -X POST http://localhost:3000/api/channels \
  -H "Content-Type: application/json" \
  -d '{"name":"Stripe","id":"stripe","signature":{"type":"stripe","secret":"whsec_..."}}'
```

### Logs API

| Method | Path | Body | Description |
|---|---|---|---|
| `GET` | `/logs/:channel` | | All logs of a channel, newest first |
| `DELETE` | `/logs/:channel` | | Delete all logs except starred ones |
| `DELETE` | `/logs/:channel/:id` | | Delete one log |
| `PATCH` | `/logs/:channel/:id` | `{ "pinned": true }` | Star or unstar a log |
| `POST` | `/logs/:channel/import` | `{ "logs": [...] }` | Import up to 500 logs (from a JSON export or HAR entries) |

A log looks like this:

```json
{
  "id": 42,
  "channel": "stripe",
  "method": "POST",
  "url": "/hook/stripe?source=test",
  "ip": "203.0.113.7",
  "headers": { "content-type": "application/json", "stripe-signature": "t=...,v1=..." },
  "query": { "source": "test" },
  "contentType": "application/json",
  "body": { "type": "payment_intent.succeeded" },
  "rawBody": "{\"type\":\"payment_intent.succeeded\"}",
  "rawEncoding": "utf8",
  "size": 36,
  "status": 200,
  "response": "{\"status\":\"OK\"}",
  "responseHeaders": { "content-type": "application/json; charset=utf-8" },
  "time": "2026-10-16T10:42:03.120Z",
  "duration": 3,
  "aborted": false,
  "signature": { "type": "stripe", "header": "stripe-signature", "valid": true, "reason": "Valid Stripe signature" },
  "pinned": false
}
```

### WebSocket

Connect to `ws://<host>:<port>/` to receive live events. To receive events for password-protected channels, send:

```json
{ "type": "AUTH", "tokens": { "<channel-id>": "<token>" } }
```

| Event | Payload |
|---|---|
| `NEW_LOG` | `channel`, `data` (the log), `dropped` (ids removed by the log limit) |
| `UPDATE_LOG` | `channel`, `data` |
| `DELETE_LOG` | `channel`, `id` |
| `CLEAR_LOGS` | `channel` |
| `RELOAD_CHANNEL` | `channel` (after an import) |
| `CHANNEL_UPSERT` | `data` (channel) |
| `CHANNEL_DELETE` | `id` |

---

## Security notes

- Sensitive request headers (`auth-key`, `authorization`, `cookie`, `channel-token`) are masked as `***` in stored logs. Signatures are verified before masking.
- Auth keys, passwords and signing secrets stay on the server; the API only reports whether they are set.
- Channels **without** a password can be viewed, changed and deleted by anyone who can reach the server. Protect any channel that matters, and run behind HTTPS when the server is exposed to the internet.
- There is no rate limiting on webhook endpoints.

---

## Limitations

- **No persistence**: channels and logs are kept in memory and are lost when the server restarts.
- **Single instance**: run one long-lived process (a VPS, Render, Railway, Fly.io...). Serverless platforms and multiple load-balanced instances will not share data.

---

## Tech stack

Node.js · Express 5 · ws (WebSocket) · plain HTML, CSS and JavaScript (no build step)

---

## License

ISC

---

Built by [Rishabh](https://in.linkedin.com/in/rishabh-builds) @ [runo.ai](https://in.linkedin.com/company/runo-ai)
