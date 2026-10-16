const { SIGNATURE_TYPES } = require('./signature');

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const METHOD_RE = /^[A-Z]{1,10}$/;
const BLOCKED_RESPONSE_HEADERS = new Set([
  'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'upgrade', 'trailer', 'te'
]);
const MASKED_HEADERS = ['auth-key', 'channel-token', 'authorization', 'cookie'];

const MAX_DELAY_MS = 30000;
const MAX_RESPONSE_BODY = 100 * 1024;
const MAX_RESPONSE_HEADERS = 20;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function maskHeaders(headers) {
  const out = { ...headers };
  MASKED_HEADERS.forEach(h => {
    if (out[h] !== undefined) out[h] = '***';
  });
  return out;
}

function validateResponse(r) {
  if (!isPlainObject(r)) return { error: 'response must be an object' };

  const status = r.status === undefined || r.status === '' ? 200 : Number(r.status);
  if (!Number.isInteger(status) || status < 100 || status > 599) return { error: 'Response status must be 100-599' };

  const delayMs = r.delayMs === undefined || r.delayMs === '' ? 0 : Number(r.delayMs);
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > MAX_DELAY_MS) {
    return { error: `Response delay must be 0-${MAX_DELAY_MS} ms` };
  }

  const body = r.body === undefined ? '' : r.body;
  if (typeof body !== 'string' || Buffer.byteLength(body) > MAX_RESPONSE_BODY) {
    return { error: 'Response body must be text up to 100 KB' };
  }

  const headers = Object.create(null);
  if (r.headers !== undefined) {
    if (!isPlainObject(r.headers)) return { error: 'Response headers must be an object' };
    const entries = Object.entries(r.headers);
    if (entries.length > MAX_RESPONSE_HEADERS) return { error: `At most ${MAX_RESPONSE_HEADERS} response headers` };
    for (const [name, value] of entries) {
      const lower = name.toLowerCase();
      if (!HEADER_NAME_RE.test(name) || BLOCKED_RESPONSE_HEADERS.has(lower)) {
        return { error: `Response header not allowed: ${name.slice(0, 50)}` };
      }
      if (typeof value !== 'string' || value.length > 1000 || /[\r\n\0]/.test(value)) {
        return { error: `Invalid value for response header ${name.slice(0, 50)}` };
      }
      headers[lower] = value;
    }
  }

  return { value: { status, headers, body, delayMs } };
}

function validateSignature(s) {
  if (!isPlainObject(s)) return { error: 'signature must be an object' };

  const type = s.type === undefined ? 'none' : s.type;
  if (!SIGNATURE_TYPES.includes(type)) return { error: 'Unknown signature type' };

  const header = s.header === undefined ? '' : s.header;
  if (typeof header !== 'string' || header.length > 100 || (header && !HEADER_NAME_RE.test(header))) {
    return { error: 'Invalid signature header name' };
  }

  const value = { type, header: header.toLowerCase() };
  if (s.secret !== undefined) {
    if (typeof s.secret !== 'string' || s.secret.length > 500) return { error: 'Signature secret: text up to 500 chars' };
    value.secret = s.secret;
  }
  return { value };
}

// Fields left undefined mean "keep current value" on update
function validateChannelInput(input, { creating = false } = {}) {
  if (!isPlainObject(input)) return { error: 'Body must be a JSON object' };
  const value = {};

  if (creating && input.id !== undefined && input.id !== '') {
    if (typeof input.id !== 'string' || !ID_RE.test(input.id)) {
      return { error: 'ID: 1-40 chars, lowercase letters, digits and dashes' };
    }
    value.id = input.id;
  }

  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 40) {
      return { error: 'Name: 1-40 chars' };
    }
    value.name = input.name.trim();
  }

  if (input.authKey !== undefined) {
    if (typeof input.authKey !== 'string' || input.authKey.length > 200) return { error: 'Auth key: text up to 200 chars' };
    value.authKey = input.authKey;
  }

  if (input.viewPassword !== undefined) {
    const pw = input.viewPassword;
    if (typeof pw !== 'string' || pw.length > 200 || (pw && pw.length < 4)) return { error: 'Password: 4-200 chars' };
    value.viewPassword = pw;
  }

  if (input.response !== undefined) {
    const r = validateResponse(input.response);
    if (r.error) return r;
    value.response = r.value;
  }

  if (input.signature !== undefined) {
    const s = validateSignature(input.signature);
    if (s.error) return s;
    value.signature = s.value;
  }

  return { value };
}

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function stringMap(v, maxKeys = 200) {
  const out = {};
  if (!isPlainObject(v)) return out;
  for (const [k, val] of Object.entries(v).slice(0, maxKeys)) {
    if (k === '__proto__') continue;
    out[k.slice(0, 200)] = typeof val === 'string' ? val.slice(0, 8000) : String(val ?? '').slice(0, 8000);
  }
  return out;
}

function finiteOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Turns an untrusted imported entry into a log shape (id/channel assigned by caller)
function sanitizeImportedLog(input, maxRaw) {
  if (!isPlainObject(input)) return null;

  const method = str(input.method, 10).toUpperCase();
  const status = Number(input.status);
  const time = new Date(input.time);
  const sig = isPlainObject(input.signature) && typeof input.signature.type === 'string'
    ? {
      type: str(input.signature.type, 20),
      header: str(input.signature.header, 100),
      valid: input.signature.valid === true,
      reason: str(input.signature.reason, 200)
    }
    : null;
  const query = isPlainObject(input.query) ? input.query : {};
  const response = typeof input.response === 'string' ? input.response : JSON.stringify(input.response ?? '');

  return {
    method: METHOD_RE.test(method) ? method : 'GET',
    url: str(input.url, 4000) || '/',
    ip: str(input.ip, 100),
    headers: maskHeaders(stringMap(input.headers)),
    query: JSON.parse(JSON.stringify(query)),
    contentType: str(input.contentType, 200),
    body: input.body === undefined ? null : input.body,
    rawBody: str(input.rawBody, maxRaw),
    rawEncoding: input.rawEncoding === 'base64' ? 'base64' : 'utf8',
    size: finiteOr(input.size, 0),
    response: response.slice(0, maxRaw),
    responseHeaders: stringMap(input.responseHeaders),
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : 200,
    time: Number.isNaN(time.getTime()) ? new Date().toISOString() : time.toISOString(),
    duration: finiteOr(input.duration, 0),
    aborted: input.aborted === true,
    signature: sig,
    pinned: input.pinned === true,
    imported: true
  };
}

module.exports = {
  ID_RE,
  MAX_DELAY_MS,
  maskHeaders,
  validateChannelInput,
  sanitizeImportedLog
};
