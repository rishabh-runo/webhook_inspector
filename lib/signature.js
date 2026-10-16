const crypto = require('crypto');

const SIGNATURE_TYPES = ['none', 'hmac-sha256', 'github', 'stripe', 'vonage'];

const DEFAULT_HEADERS = {
  'hmac-sha256': 'x-signature',
  github: 'x-hub-signature-256',
  stripe: 'stripe-signature',
  vonage: 'authorization'
};

const STRIPE_TOLERANCE_SEC = 300;

function timingEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function hmac(secret, data, encoding) {
  return crypto.createHmac('sha256', secret).update(data).digest(encoding);
}

function verifyHmac(secret, value, raw) {
  const sig = value.replace(/^sha256=/i, '').trim();
  const ok = timingEqual(sig.toLowerCase(), hmac(secret, raw, 'hex')) ||
    timingEqual(sig, hmac(secret, raw, 'base64'));
  return ok ? [true, 'Valid HMAC-SHA256 signature'] : [false, 'Signature mismatch'];
}

function verifyGithub(secret, value, raw) {
  const ok = timingEqual(value.trim(), 'sha256=' + hmac(secret, raw, 'hex'));
  return ok ? [true, 'Valid GitHub signature'] : [false, 'Signature mismatch'];
}

// Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>]; signed payload is "<t>.<raw body>"
function verifyStripe(secret, value, raw) {
  const pairs = value.split(',').map(p => p.trim().split('='));
  const t = pairs.find(([k]) => k === 't')?.[1];
  const v1s = pairs.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !v1s.length) return [false, 'Malformed Stripe-Signature header'];

  const expected = hmac(secret, Buffer.concat([Buffer.from(`${t}.`), raw]), 'hex');
  if (!v1s.some(v => timingEqual(v, expected))) return [false, 'Signature mismatch'];

  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!(age <= STRIPE_TOLERANCE_SEC)) return [false, 'Valid signature but timestamp is outside the 5 min tolerance'];
  return [true, 'Valid Stripe signature'];
}

// Vonage signed webhooks: Authorization: Bearer <HS256 JWT>, payload_hash = sha256(raw body)
function verifyVonage(secret, value, raw) {
  const segs = value.replace(/^Bearer\s+/i, '').trim().split('.');
  if (segs.length !== 3) return [false, 'Malformed JWT'];

  let header, payload;
  try {
    header = JSON.parse(Buffer.from(segs[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(segs[1], 'base64url').toString('utf8'));
  } catch {
    return [false, 'Malformed JWT'];
  }

  if (header?.alg !== 'HS256') return [false, `Unsupported JWT alg: ${String(header?.alg).slice(0, 20)}`];
  if (!timingEqual(segs[2], hmac(secret, `${segs[0]}.${segs[1]}`, 'base64url'))) {
    return [false, 'JWT signature mismatch'];
  }
  if (payload?.payload_hash) {
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    if (!timingEqual(String(payload.payload_hash).toLowerCase(), hash)) {
      return [false, 'Valid JWT but payload_hash does not match the body'];
    }
  }
  return [true, 'Valid Vonage JWT'];
}

const VERIFIERS = {
  'hmac-sha256': verifyHmac,
  github: verifyGithub,
  stripe: verifyStripe,
  vonage: verifyVonage
};

// Returns null when the channel has no signature check, else { type, header, valid, reason }
function verifySignature(config, headers, raw = Buffer.alloc(0)) {
  if (!config || config.type === 'none' || !VERIFIERS[config.type]) return null;

  const header = (config.header || DEFAULT_HEADERS[config.type]).toLowerCase();
  const result = (valid, reason) => ({ type: config.type, header, valid, reason });

  if (!config.secret) return result(false, 'No secret configured for this channel');
  const value = headers[header];
  if (!value) return result(false, `Missing ${header} header`);

  const [valid, reason] = VERIFIERS[config.type](config.secret, String(value), raw);
  return result(valid, reason);
}

module.exports = { SIGNATURE_TYPES, DEFAULT_HEADERS, verifySignature };
