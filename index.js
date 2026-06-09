const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

require('dotenv').config();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const API_TOKEN = process.env.AUTH_KEY;
const PORT = 3000;

const channels = {
  open: [],
  secure: []
};

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
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
      if (req.method !== 'GET' && req.method !== 'POST') return;

      const log = {
        id: Date.now(),
        method: req.method,
        url: req.originalUrl,
        headers: req.headers,
        query: req.query,
        body: req.body,
        response: responseBody,
        status: res.statusCode,
        time: new Date().toISOString(),
        duration: Date.now() - start
      };

      channels[channel].unshift(log);
      broadcast({ type: 'NEW_LOG', channel, data: log });
    });

    next();
  };
}

function authMiddleware(req, res, next) {
  const token = req.headers['auth-key'];
  if (!token || token !== API_TOKEN) {
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
app.get('/logs/:channel', (req, res) => {
  const ch = req.params.channel;
  if (!channels[ch]) return res.status(404).json({ message: 'Unknown channel' });
  res.json(channels[ch]);
});

app.delete('/logs/:channel', (req, res) => {
  const ch = req.params.channel;
  if (!channels[ch]) return res.status(404).json({ message: 'Unknown channel' });
  channels[ch] = [];
  broadcast({ type: 'CLEAR_LOGS', channel: ch });
  res.json({ status: 'cleared' });
});

app.delete('/logs/:channel/:id', (req, res) => {
  const ch = req.params.channel;
  const id = parseInt(req.params.id);
  if (!channels[ch]) return res.status(404).json({ message: 'Unknown channel' });
  channels[ch] = channels[ch].filter(log => log.id !== id);
  broadcast({ type: 'DELETE_LOG', channel: ch, id });
  res.json({ status: 'deleted' });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
