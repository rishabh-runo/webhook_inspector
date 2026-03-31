const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const API_TOKEN = "q83kF9s269Z1lYwQvP4g8cJzR7mHnT5uD2aB6L0Xc9eVwYp3tS1k==";
const PORT = 3000;

let logs = [];

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function addLog(log) {
  logs.unshift(log);
  broadcast({ type: 'NEW_LOG', data: log });
}

// ----------- LOG ONLY /webhook -----------
app.use((req, res, next) => {
  if (!req.originalUrl.startsWith('/webhook')) return next();

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

    addLog(log);
  });

  next();
});

// ----------- AUTH -----------
function authMiddleware(req, res, next) {
  const token = req.headers['auth-key'];
  if (!token || token !== API_TOKEN) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  next();
}

// ----------- WEBHOOK -----------
app.all('/webhook', authMiddleware, (req, res) => {
  res.json({ status: 'OK' });
});

// ----------- CLEAR LOGS -----------
app.delete('/logs', (req, res) => {
  logs = [];
  broadcast({ type: 'CLEAR_LOGS' });
  res.json({ status: 'cleared' });
});

app.delete('/logs/:id', (req, res) => {
  const id = parseInt(req.params.id);

  logs = logs.filter(log => log.id !== id);

  broadcast({ type: 'DELETE_LOG', id });

  res.json({ status: 'deleted' });
});

app.get('/logs', (req, res) => res.json(logs));

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});