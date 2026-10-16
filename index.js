require('dotenv').config();

const express = require('express');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

const API_TOKEN = process.env.AUTH_KEY;
const VIEWER_KEY = process.env.VIEWER_KEY; // optional: protects /logs and the WebSocket
const PORT = parseInt(process.env.PORT) || 3000;
const MAX_LOGS = parseInt(process.env.MAX_LOGS) || 500;
const MASKED_HEADERS = ['auth-key', 'viewer-key', 'authorization', 'cookie'];

// Constant-time compare; fails closed when the expected value is unset
function safeEqual(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function viewerAllowed(key) {
  return !VIEWER_KEY || safeEqual(key, VIEWER_KEY);
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({
  server,
  verifyClient: ({ req }) => {
    const key = new URL(req.url, 'http://localhost').searchParams.get('key');
    return viewerAllowed(key);
  }
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const channels = {
  open: [],
  secure: []
};

let nextId = 1;

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

function maskHeaders(headers) {
  const out = { ...headers };
  MASKED_HEADERS.forEach(h => {
    if (out[h] !== undefined) out[h] = '***';
  });
  return out;
}

function makeLogger(channel) {
  return (req, res, next) => {
    const start = Date.now();
    const originalSend = res.send;
    let responseBody;

    res.send = function (body) {
      responseBody = body;
      return originalSend.call(this, body);
    };

    res.on('finish', () => {
      const log = {
        id: nextId++,
        method: req.method,
        url: req.originalUrl,
        headers: maskHeaders(req.headers),
        query: req.query,
        body: req.body,
        response: responseBody,
        status: res.statusCode,
        time: new Date().toISOString(),
        duration: Date.now() - start
      };

      channels[channel].unshift(log);
      if (channels[channel].length > MAX_LOGS) channels[channel].length = MAX_LOGS;
      broadcast({ type: 'NEW_LOG', channel, data: log });
    });

    next();
  };
}

function authMiddleware(req, res, next) {
  if (!safeEqual(req.headers['auth-key'], API_TOKEN)) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  next();
}

function viewerAuth(req, res, next) {
  if (!viewerAllowed(req.headers['viewer-key'])) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  next();
}

// ----------- WEBHOOKS -----------
app.all('/hook/open', makeLogger('open'), (req, res) => {
  res.json({ status: 'OK' });
});

app.all('/hook/secure', makeLogger('secure'), authMiddleware, (req, res) => {
  res.json({ status: 'OK' });
});

// ----------- LOGS API -----------
app.use('/logs', viewerAuth);

app.get('/logs/:channel', (req, res) => {
  const ch = req.params.channel;
  if (!Object.hasOwn(channels, ch)) return res.status(404).json({ message: 'Unknown channel' });
  res.json(channels[ch]);
});

app.delete('/logs/:channel', (req, res) => {
  const ch = req.params.channel;
  if (!Object.hasOwn(channels, ch)) return res.status(404).json({ message: 'Unknown channel' });
  channels[ch] = [];
  broadcast({ type: 'CLEAR_LOGS', channel: ch });
  res.json({ status: 'cleared' });
});

app.delete('/logs/:channel/:id', (req, res) => {
  const ch = req.params.channel;
  const id = parseInt(req.params.id);
  if (!Object.hasOwn(channels, ch)) return res.status(404).json({ message: 'Unknown channel' });
  channels[ch] = channels[ch].filter(log => log.id !== id);
  broadcast({ type: 'DELETE_LOG', channel: ch, id });
  res.json({ status: 'deleted' });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  if (!API_TOKEN) console.warn('AUTH_KEY not set: /hook/secure will reject every request');
  if (!VIEWER_KEY) console.warn('VIEWER_KEY not set: logs are readable by anyone who can reach this server');
});
