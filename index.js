require('dotenv').config();

const express = require('express');
const http = require('http');
const crypto = require('crypto');
const util = require('util');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const { verifySignature } = require('./lib/signature');
const { maskHeaders, validateChannelInput, sanitizeImportedLog } = require('./lib/validate');

const API_TOKEN = process.env.AUTH_KEY;
const PORT = parseInt(process.env.PORT) || 3000;
const MAX_LOGS = parseInt(process.env.MAX_LOGS) || 500;
const MAX_CHANNELS = parseInt(process.env.MAX_CHANNELS) || 50;
const MAX_IMPORT = 500;
const BODY_LIMIT = process.env.BODY_LIMIT || '10mb';
const MAX_RAW_CHARS = 15 * 1024 * 1024;
const MAX_UNLOCK_ATTEMPTS = 10;
const UNLOCK_WINDOW_MS = 10 * 60 * 1000;

// Signs channel access tokens; new on every start, so tokens die with the in-memory channels
const TOKEN_SECRET = crypto.randomBytes(32);
const scrypt = util.promisify(crypto.scrypt);

// Constant-time compare; fails closed when the expected value is unset
function safeEqual(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) {
  const tp = process.env.TRUST_PROXY;
  app.set('trust proxy', tp === 'true' ? true : /^\d+$/.test(tp) ? Number(tp) : tp);
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 64 * 1024 });

app.use(express.static(path.join(__dirname, 'public')));

// ----------- CHANNELS -----------
const DEFAULT_RESPONSE = { status: 200, headers: {}, body: '{"status":"OK"}', delayMs: 0 };

const channels = new Map();
let nextId = 1;

function createChannel({ id, name, builtin = false, requireAuth = false, authKey = '' }) {
  return {
    id,
    name: name || id,
    builtin,
    requireAuth,
    authKey,
    view: null,        // { salt, hash } when the logs are password protected
    viewVersion: 0,    // bumped on every password change, invalidates old tokens
    response: { ...DEFAULT_RESPONSE, headers: {} },
    signature: { type: 'none', header: '', secret: '' },
    logs: [],
    createdAt: new Date().toISOString()
  };
}

channels.set('open', createChannel({ id: 'open', builtin: true }));
channels.set('secure', createChannel({ id: 'secure', builtin: true, requireAuth: true, authKey: API_TOKEN || '' }));

// Channel list is public: never expose secrets or the logs of a protected channel
function publicChannel(ch) {
  return {
    id: ch.id,
    name: ch.name,
    builtin: ch.builtin,
    requireAuth: ch.requireAuth,
    hasAuthKey: !!ch.authKey,
    locked: !!ch.view,
    lockVersion: ch.viewVersion,
    response: ch.response,
    signature: { type: ch.signature.type, header: ch.signature.header, hasSecret: !!ch.signature.secret },
    count: ch.view ? null : ch.logs.length,
    createdAt: ch.createdAt
  };
}

// ----------- CHANNEL PASSWORDS -----------
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return { salt, hash: await scrypt(password, salt, 32) };
}

async function checkPassword(password, view) {
  const hash = await scrypt(password, view.salt, 32);
  return crypto.timingSafeEqual(hash, view.hash);
}

function channelToken(ch) {
  return crypto.createHmac('sha256', TOKEN_SECRET).update(`${ch.id}:${ch.viewVersion}`).digest('base64url');
}

function hasAccess(ch, token) {
  return !ch.view || safeEqual(token, channelToken(ch));
}

function requireAccess(req, res, ch) {
  if (hasAccess(ch, req.headers['channel-token'])) return true;
  res.status(403).json({ message: 'This channel is password protected', locked: true });
  return false;
}

// Brute-force guard for unlock: per IP + channel
const unlockAttempts = new Map();

function unlockBlocked(key) {
  const a = unlockAttempts.get(key);
  return !!a && a.resetAt > Date.now() && a.count >= MAX_UNLOCK_ATTEMPTS;
}

function recordUnlockFailure(key) {
  const now = Date.now();
  const a = unlockAttempts.get(key);
  if (!a || a.resetAt <= now) unlockAttempts.set(key, { count: 1, resetAt: now + UNLOCK_WINDOW_MS });
  else a.count++;
}

setInterval(() => {
  const now = Date.now();
  unlockAttempts.forEach((a, key) => { if (a.resetAt <= now) unlockAttempts.delete(key); });
}, UNLOCK_WINDOW_MS).unref();

async function applyChannelInput(ch, value) {
  if (value.name !== undefined) ch.name = value.name;
  if (value.authKey !== undefined) {
    ch.authKey = value.authKey;
    ch.requireAuth = !!value.authKey;
  }
  if (value.viewPassword !== undefined) {
    ch.view = value.viewPassword ? await hashPassword(value.viewPassword) : null;
    ch.viewVersion++;
  }
  if (value.response !== undefined) ch.response = value.response;
  if (value.signature !== undefined) {
    const { secret, ...rest } = value.signature;
    ch.signature = { ...rest, secret: secret !== undefined ? secret : ch.signature.secret };
  }
}

// Response for create/update: the editor gets a fresh token so they stay unlocked
function channelResponse(ch) {
  return { ...publicChannel(ch), token: ch.view ? channelToken(ch) : null };
}

// ----------- WEBSOCKET -----------
// Clients send { type: 'AUTH', tokens: { channelId: token } } to receive protected channels
wss.on('connection', (ws) => {
  ws.tokens = new Map();
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg?.type !== 'AUTH' || !msg.tokens || typeof msg.tokens !== 'object') return;
    ws.tokens = new Map(
      Object.entries(msg.tokens).slice(0, MAX_CHANNELS).filter(([, t]) => typeof t === 'string')
    );
  });
});

// channelId set = only clients allowed to see that channel get the message
function broadcast(data, channelId) {
  const msg = JSON.stringify(data);
  const ch = channelId ? channels.get(channelId) : null;
  const expected = ch?.view ? channelToken(ch) : null;

  wss.clients.forEach(client => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (expected && !safeEqual(client.tokens?.get(channelId), expected)) return;
    client.send(msg);
  });
}

// Drop oldest unstarred logs above the cap; returns dropped ids
function trimLogs(ch) {
  const dropped = [];
  for (let i = ch.logs.length - 1; i >= 0 && ch.logs.length > MAX_LOGS; i--) {
    if (!ch.logs[i].pinned) {
      dropped.push(ch.logs[i].id);
      ch.logs.splice(i, 1);
    }
  }
  return dropped;
}

// ----------- WEBHOOK PIPELINE -----------
function resolveChannel(req, res, next) {
  const ch = channels.get(req.params.channel);
  if (!ch) return res.status(404).json({ message: 'Unknown channel' });
  req.channelObj = ch;
  next();
}

function makeLogger(req, res, next) {
  const start = Date.now();
  const originalSend = res.send;
  let responseBody;

  res.send = function (body) {
    responseBody = Buffer.isBuffer(body) ? body.toString('utf8') : body;
    return originalSend.call(this, body);
  };

  res.once('close', () => {
    const ch = req.channelObj;
    if (channels.get(ch.id) !== ch) return; // channel deleted meanwhile

    const log = {
      id: nextId++,
      channel: ch.id,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip || '',
      headers: maskHeaders(req.headers),
      query: req.query,
      contentType: req.headers['content-type'] || '',
      body: req.parsedBody ?? null,
      rawBody: req.rawBody || '',
      rawEncoding: req.rawEncoding || 'utf8',
      size: req.rawBuffer ? req.rawBuffer.length : 0,
      response: typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody ?? ''),
      responseHeaders: { ...res.getHeaders() },
      status: res.statusCode,
      time: new Date().toISOString(),
      duration: Date.now() - start,
      aborted: !res.writableFinished,
      signature: req.signatureResult || null,
      pinned: false
    };

    ch.logs.unshift(log);
    const dropped = trimLogs(ch);
    broadcast({ type: 'NEW_LOG', channel: ch.id, data: log, dropped }, ch.id);
  });

  next();
}

// Accept any content type as raw bytes so nothing is lost (text, XML, binary...)
const rawParser = express.raw({ type: () => true, limit: BODY_LIMIT });

function parseBody(text, contentType) {
  if (!text) return null;
  const ct = contentType.toLowerCase();
  if (ct.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function captureBody(req, res, next) {
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const text = buf.toString('utf8');
  const isText = Buffer.from(text, 'utf8').equals(buf);

  req.rawBuffer = buf;
  req.rawBody = isText ? text : buf.toString('base64');
  req.rawEncoding = isText ? 'utf8' : 'base64';
  req.parsedBody = isText ? parseBody(text, req.headers['content-type'] || '') : null;
  req.signatureResult = verifySignature(req.channelObj.signature, req.headers, buf);
  next();
}

function channelAuth(req, res, next) {
  const ch = req.channelObj;
  if (ch.requireAuth && !safeEqual(req.headers['auth-key'], ch.authKey)) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  next();
}

async function customResponse(req, res) {
  const { status, headers, body, delayMs } = req.channelObj.response;
  if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
  if (req.socket.destroyed) return;

  for (const [name, value] of Object.entries(headers)) res.set(name, value);
  if (!res.get('content-type')) {
    let isJson = false;
    try { JSON.parse(body); isJson = true; } catch { /* plain text */ }
    res.type(isJson ? 'application/json' : 'text/plain');
  }
  res.status(status).send(body);
}

// CORS only for webhook endpoints, so other websites can't read the dashboard API
app.all('/hook/:channel{/*rest}', cors(), resolveChannel, makeLogger, rawParser, captureBody, channelAuth, customResponse);

// ----------- DASHBOARD API -----------
app.use(['/api', '/logs'], express.json({ limit: BODY_LIMIT }));

function findChannel(req, res) {
  const ch = channels.get(req.params.channel);
  if (!ch) res.status(404).json({ message: 'Unknown channel' });
  return ch;
}

app.get('/api/channels', (req, res) => {
  res.json([...channels.values()].map(publicChannel));
});

app.post('/api/channels', async (req, res) => {
  if (channels.size >= MAX_CHANNELS) return res.status(400).json({ message: `Channel limit (${MAX_CHANNELS}) reached` });

  const { value, error } = validateChannelInput(req.body, { creating: true });
  if (error) return res.status(400).json({ message: error });

  const id = value.id || crypto.randomBytes(4).toString('hex');
  if (channels.has(id)) return res.status(409).json({ message: `Channel "${id}" already exists` });

  const ch = createChannel({ id, name: value.name });
  await applyChannelInput(ch, value);
  if (channels.has(id)) return res.status(409).json({ message: `Channel "${id}" already exists` });

  channels.set(id, ch);
  broadcast({ type: 'CHANNEL_UPSERT', data: publicChannel(ch) });
  res.status(201).json(channelResponse(ch));
});

app.post('/api/channels/:channel/unlock', async (req, res) => {
  const ch = findChannel(req, res);
  if (!ch) return;
  if (!ch.view) return res.json({ token: null });

  const key = `${req.ip}|${ch.id}`;
  if (unlockBlocked(key)) return res.status(429).json({ message: 'Too many wrong passwords. Try again in 10 minutes.' });

  const password = req.body?.password;
  if (typeof password !== 'string' || !password || password.length > 200 || !(await checkPassword(password, ch.view))) {
    recordUnlockFailure(key);
    return res.status(403).json({ message: 'Wrong password', locked: true });
  }
  unlockAttempts.delete(key);
  res.json({ token: channelToken(ch) });
});

app.patch('/api/channels/:channel', async (req, res) => {
  const ch = findChannel(req, res);
  if (!ch) return;
  if (ch.builtin) return res.status(400).json({ message: 'Built-in channels cannot be changed' });
  if (!requireAccess(req, res, ch)) return;

  const { value, error } = validateChannelInput(req.body);
  if (error) return res.status(400).json({ message: error });

  await applyChannelInput(ch, value);
  broadcast({ type: 'CHANNEL_UPSERT', data: publicChannel(ch) });
  res.json(channelResponse(ch));
});

app.delete('/api/channels/:channel', (req, res) => {
  const ch = findChannel(req, res);
  if (!ch) return;
  if (ch.builtin) return res.status(400).json({ message: 'Built-in channels cannot be deleted' });
  if (!requireAccess(req, res, ch)) return;

  channels.delete(ch.id);
  broadcast({ type: 'CHANNEL_DELETE', id: ch.id });
  res.json({ status: 'deleted' });
});

app.get('/logs/:channel', (req, res) => {
  const ch = findChannel(req, res);
  if (ch && requireAccess(req, res, ch)) res.json(ch.logs);
});

// Starred logs survive a clear
app.delete('/logs/:channel', (req, res) => {
  const ch = findChannel(req, res);
  if (!ch || !requireAccess(req, res, ch)) return;
  ch.logs = ch.logs.filter(log => log.pinned);
  broadcast({ type: 'CLEAR_LOGS', channel: ch.id }, ch.id);
  res.json({ status: 'cleared' });
});

app.delete('/logs/:channel/:id', (req, res) => {
  const ch = findChannel(req, res);
  if (!ch || !requireAccess(req, res, ch)) return;
  const id = parseInt(req.params.id);
  ch.logs = ch.logs.filter(log => log.id !== id);
  broadcast({ type: 'DELETE_LOG', channel: ch.id, id }, ch.id);
  res.json({ status: 'deleted' });
});

app.patch('/logs/:channel/:id', (req, res) => {
  const ch = findChannel(req, res);
  if (!ch || !requireAccess(req, res, ch)) return;
  const log = ch.logs.find(l => l.id === parseInt(req.params.id));
  if (!log) return res.status(404).json({ message: 'Unknown log' });
  if (typeof req.body?.pinned !== 'boolean') return res.status(400).json({ message: 'pinned must be true or false' });

  log.pinned = req.body.pinned;
  broadcast({ type: 'UPDATE_LOG', channel: ch.id, data: log }, ch.id);
  res.json(log);
});

app.post('/logs/:channel/import', (req, res) => {
  const ch = findChannel(req, res);
  if (!ch || !requireAccess(req, res, ch)) return;
  const input = req.body?.logs;
  if (!Array.isArray(input)) return res.status(400).json({ message: 'Expected { logs: [...] }' });
  if (input.length > MAX_IMPORT) return res.status(400).json({ message: `At most ${MAX_IMPORT} logs per import` });

  const imported = input
    .map(entry => sanitizeImportedLog(entry, MAX_RAW_CHARS))
    .filter(Boolean)
    .map(log => ({ ...log, id: nextId++, channel: ch.id }));

  ch.logs = [...imported, ...ch.logs].sort((a, b) => new Date(b.time) - new Date(a.time));
  trimLogs(ch);
  broadcast({ type: 'RELOAD_CHANNEL', channel: ch.id }, ch.id);
  res.json({ imported: imported.length });
});

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ message: err.expose ? err.message : 'Server error' });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  if (!API_TOKEN) console.warn('AUTH_KEY not set: /hook/secure will reject every request');
});
