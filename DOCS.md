# Vonage Webhook Inspector — Project Documentation

## Overview

A lightweight, real-time webhook inspection tool built with Node.js. It captures incoming HTTP requests (primarily from Vonage SMS/Voice APIs), stores them in memory, and streams them live to a browser-based dashboard via WebSocket.

Intended for local development and debugging — not production use (no persistence, no horizontal scaling).

---

## Project Structure

```
vonageWebhook/
├── index.js           # Express server + WebSocket server (all backend logic)
├── package.json       # NPM manifest
├── package-lock.json  # Locked dependency tree
├── .env               # Environment variables (not committed)
├── .gitignore
└── public/
    └── index.html     # Single-page dashboard (HTML + CSS + JS, no build step)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (CommonJS) |
| HTTP Framework | Express 5.x |
| Real-time | WebSocket (`ws` library) |
| CORS | `cors` package |
| Env Config | `dotenv` |
| Frontend | Vanilla HTML/CSS/JS |

---

## Environment Variables

Create a `.env` file in the project root:

```env
AUTH_KEY=your_secret_key_here
```

| Variable | Used As | Default in `.env` |
|---|---|---|
| `AUTH_KEY` | `Authorization` token for `/webhook` endpoint | `test` |

Loaded at startup via `require('dotenv').config()` and read as `process.env.AUTH_KEY`.

---

## Running the Server

```bash
npm install
node index.js
```

Server starts on **http://localhost:3000**.

---

## Architecture

```
                         ┌─────────────────────────┐
                         │  External Caller         │
                         │  (Vonage, curl, etc.)    │
                         └────────────┬────────────┘
                                      │
                         POST /webhook
                         Header: auth-key: <token>
                                      │
                         ┌────────────v────────────┐
                         │  Logging Middleware      │
                         │  (intercepts /webhook)   │
                         └────────────┬────────────┘
                                      │
                         ┌────────────v────────────┐
                         │  authMiddleware          │
                         │  (validates auth-key)    │
                         └────────────┬────────────┘
                                      │
                         ┌────────────v────────────┐
                         │  Route Handler           │
                         │  res.json({status:'OK'}) │
                         └────────────┬────────────┘
                                      │
                              response fires 'finish'
                                      │
                         ┌────────────v────────────┐
                         │  addLog()                │
                         │  logs.unshift(log)       │
                         │  broadcast(NEW_LOG)      │
                         └────────────┬────────────┘
                                      │
                         ┌────────────v────────────┐
                         │  WebSocket Broadcast     │
                         │  → all connected clients │
                         └────────────┬────────────┘
                                      │
                         ┌────────────v────────────┐
                         │  Browser Dashboard       │
                         │  public/index.html       │
                         │  renders log in real-time│
                         └─────────────────────────┘
```

---

## Backend — `index.js`

### Server Setup (lines 1–19)

```js
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });
```

Both the Express app and WebSocket server share the same underlying HTTP server so they run on the same port (3000).

Middleware applied globally:
- `cors()` — allows cross-origin requests
- `express.json({ limit: '10mb' })` — parses JSON bodies up to 10 MB
- `express.urlencoded({ extended: true })` — parses form-encoded bodies
- `express.static('public')` — serves the dashboard at `/`

### In-memory Store

```js
let logs = [];
```

All captured logs live here. Wiped on process restart.

### WebSocket Broadcast (lines 23–30)

```js
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}
```

Iterates every connected WebSocket client and sends a JSON message. Skips clients that are not yet fully open.

### Logging Middleware (lines 38–71)

Applied only to paths starting with `/webhook`. Wraps `res.send` to capture the response body, then listens for the `finish` event to build and store the log entry.

Only `GET` and `POST` methods are logged (other methods are passed through but not stored).

**Log object shape:**

```js
{
  id:       Date.now(),          // number — used as unique identifier
  method:   req.method,          // 'GET' | 'POST'
  url:      req.originalUrl,     // full path including query string
  headers:  req.headers,         // all request headers
  query:    req.query,           // parsed query params
  body:     req.body,            // parsed request body
  response: responseBody,        // raw response body string
  status:   res.statusCode,      // HTTP status code
  time:     new Date().toISOString(),
  duration: Date.now() - start   // milliseconds
}
```

### Authentication Middleware (lines 74–80)

```js
function authMiddleware(req, res, next) {
  const token = req.headers['auth-key'];
  if (!token || token !== API_TOKEN) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  next();
}
```

Reads the `auth-key` request header and compares it to `process.env.AUTH_KEY`. Returns 401 on mismatch.

---

## API Reference

### `ALL /webhook`

The primary target endpoint. Accepts any HTTP method.

| | |
|---|---|
| Auth | Required (`auth-key` header) |
| Response | `200 { "status": "OK" }` |
| Side effect | Request is captured and broadcast to dashboard |

**Example request:**
```bash
curl -X POST http://localhost:3000/webhook \
  -H "auth-key: test" \
  -H "Content-Type: application/json" \
  -d '{"event":"sms","from":"+1234567890","text":"Hello"}'
```

**Auth failure response:**
```json
{ "message": "Unauthorized" }
```

---

### `GET /logs`

Returns all stored logs as a JSON array (newest first, since entries are unshifted).

| | |
|---|---|
| Auth | None |
| Response | `200 [ ...logs ]` |

---

### `DELETE /logs`

Clears all logs from memory and broadcasts `CLEAR_LOGS` to all dashboard clients.

| | |
|---|---|
| Auth | None |
| Response | `200 { "status": "cleared" }` |
| Broadcast | `{ "type": "CLEAR_LOGS" }` |

---

### `DELETE /logs/:id`

Deletes a single log by its `id` (timestamp integer) and broadcasts `DELETE_LOG`.

| | |
|---|---|
| Auth | None |
| Param | `:id` — the log's `id` field |
| Response | `200 { "status": "deleted" }` |
| Broadcast | `{ "type": "DELETE_LOG", "id": <number> }` |

---

## WebSocket Protocol

The client connects to the same host/port as the HTTP server:

```js
const ws = new WebSocket(`ws://localhost:3000`);
```

The server broadcasts three message types:

| `type` | Payload | Trigger |
|---|---|---|
| `NEW_LOG` | `{ type, data: logObject }` | New webhook received |
| `CLEAR_LOGS` | `{ type }` | `DELETE /logs` called |
| `DELETE_LOG` | `{ type, id: number }` | `DELETE /logs/:id` called |

---

## Frontend — `public/index.html`

A single self-contained HTML file. No framework, no build tool.

### Initialization Flow

1. `fetch('/logs')` — loads existing logs on page open
2. Reverse array so newest appears at top
3. Render all logs to DOM via `refresh()`
4. Open WebSocket connection
5. Listen for real-time messages and update DOM accordingly

### Key JavaScript Functions

| Function | Purpose |
|---|---|
| `renderLog(log, index)` | Builds a DOM element for a single log entry |
| `refresh()` | Clears `#logs` div and re-renders all entries |
| `toggle(el)` | Expand/collapse a log's detail panel |
| `toggleSection(el)` | Expand/collapse an individual section (Headers, Query, Body, Response) |
| `section(title, data)` | Returns HTML string for a collapsible data section |
| `safeParse(data)` | Tries `JSON.parse`, falls back to raw value |
| `indicator(obj)` | Returns ⚪ (empty) or 🟢 (has data) |
| `deleteLog(e, id)` | Calls `DELETE /logs/:id` |
| `clearLogs()` | Calls `DELETE /logs` |

### Visual Styling

- **GET requests** — green left border + green glow
- **POST requests** — blue left border + blue glow
- **4xx/5xx responses** — red box shadow
- **Status badge** — green for success, red for error
- Dark background (`#020617`), glassmorphism header, Inter font

---

## Vonage Integration Context

Vonage (formerly Nexmo) sends webhook callbacks to a configured URL when telephony events occur. This server acts as the receiver.

**Typical Vonage webhook events this tool would capture:**

| Category | Events |
|---|---|
| SMS | Inbound message, delivery receipt, failed delivery |
| Voice | Call answered, call hangup, DTMF input, recording ready |
| Application | Number registered/unregistered, balance alerts |

**How to point Vonage at this server:**

1. Expose the local server publicly (e.g. via `ngrok http 3000`)
2. Set your Vonage application webhook URL to: `https://<ngrok-id>.ngrok.io/webhook`
3. Configure Vonage to send `auth-key: test` in request headers (or update `AUTH_KEY` in `.env`)

---

## Limitations

| Limitation | Detail |
|---|---|
| No persistence | All logs live in `let logs = []`; wiped on restart |
| Single process | No support for multiple server instances sharing logs |
| No log cap | Memory grows unbounded; clear logs manually |
| Only GET/POST logged | Other HTTP methods hit the endpoint but are not stored |
| No HTTPS | Dashboard and WebSocket run plain HTTP/WS unless wrapped |
| No rate limiting | No throttle on the `/webhook` endpoint |

---

## Dependency Versions (from `package.json`)

```json
{
  "cors":   "^2.8.6",
  "dotenv": "^17.3.1",
  "express": "^5.2.1",
  "ws":     "^8.20.0"
}
```
