const crypto = require('crypto');
const config = require('../config');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** API keys look like mk_live_<48 hex>. Only their SHA-256 hash is stored. */
function newApiKey() {
  const key = `mk_live_${crypto.randomBytes(24).toString('hex')}`;
  return { key, hash: sha256(key), prefix: key.slice(0, 14) };
}

// Passwords: scrypt with a random salt, stored as "salt:hash".
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64, SCRYPT).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  return safeEqual(crypto.scryptSync(pw, salt, 64, SCRYPT).toString('hex'), hash);
}

// Signed user tokens: base64url(json).base64url(hmac). Bound to one app.
const b64 = (b) => Buffer.from(b).toString('base64url');
function signToken(payload, ttlHours = config.tokenTtlHours) {
  const body = b64(JSON.stringify({ ...payload, exp: Date.now() + ttlHours * 3600e3 }));
  const sig = crypto.createHmac('sha256', config.tokenSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', config.tokenSecret).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

const hmac = (secret, body) => crypto.createHmac('sha256', secret).update(body).digest('hex');

module.exports = { sha256, safeEqual, newApiKey, hashPassword, verifyPassword, signToken, verifyToken, hmac };
