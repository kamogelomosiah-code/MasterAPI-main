const config = require('../config');
const { findByKey, getApp } = require('./apps');
const { safeEqual, verifyToken } = require('./security');
const { getStore, now } = require('./store');
const { ah, unauthorized, forbidden, ApiError } = require('./errors');

/** Admin routes: Authorization: Bearer <MASTER_KEY> (or X-Master-Key). */
const requireAdmin = (req, res, next) => {
  if (!config.masterKey) return next(new ApiError(503, 'Admin is disabled. Set MASTER_KEY in the environment.'));
  const given = req.get('x-master-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!given || !safeEqual(given, config.masterKey)) return next(unauthorized('Invalid master key'));
  next();
};

// Simple fixed-window rate limit per app, in memory.
const windows = new Map();
function rateLimited(app) {
  const minute = Math.floor(Date.now() / 60000);
  const w = windows.get(app.id);
  if (!w || w.minute !== minute) {
    windows.set(app.id, { minute, n: 1 });
    return { limited: false, remaining: app.rateLimitPerMinute - 1 };
  }
  w.n++;
  return { limited: w.n > app.rateLimitPerMinute, remaining: Math.max(0, app.rateLimitPerMinute - w.n) };
}

/** App routes: X-API-Key header (or ?apiKey= for quick testing). Sets req.app_ */
const requireApp = ah(async (req, res, next) => {
  // The admin console can act as any app: X-Master-Key + X-App-Id (no app key needed).
  const mk = req.get('x-master-key');
  if (mk && req.get('x-app-id')) {
    if (!config.masterKey || !safeEqual(mk, config.masterKey)) throw unauthorized('Invalid master key');
    req.client = await getApp(req.get('x-app-id'));
    return next();
  }
  const key = req.get('x-api-key') || req.query.apiKey;
  if (!key) throw unauthorized('API key required. Send it in the X-API-Key header.');
  const app = await findByKey(String(key));
  if (!app) throw unauthorized('Invalid API key');
  if (!app.active) throw forbidden('This app is disabled');
  const origin = req.get('origin');
  if (origin && app.allowedOrigins?.length && !app.allowedOrigins.includes(origin) && !app.allowedOrigins.includes('*')) {
    throw forbidden(`Origin ${origin} is not allowed for this app`);
  }
  const rl = rateLimited(app);
  res.set('X-RateLimit-Limit', String(app.rateLimitPerMinute));
  res.set('X-RateLimit-Remaining', String(rl.remaining));
  if (rl.limited) {
    res.set('Retry-After', String(60 - (Math.floor(Date.now() / 1000) % 60)));
    throw new ApiError(429, 'Rate limit exceeded. Try again in a minute.');
  }
  req.client = app;
  delete req.query.apiKey;
  // Usage stats per app per day (fire and forget).
  const day = now().slice(0, 10);
  getStore().inc('_system:usage', { id: `${app.id}:${day}` }, 'requests', 1, { id: `${app.id}:${day}`, appId: app.id, day, createdAt: now() }).catch(() => {});
  next();
});

/** Reads an end-user token if present (Authorization: Bearer <token>). Sets req.user = { id, email }. */
const optionalUser = (req, res, next) => {
  const h = req.get('authorization') || '';
  if (/^Bearer\s+/i.test(h)) {
    const p = verifyToken(h.replace(/^Bearer\s+/i, ''));
    if (!p || p.app !== req.client.id) return next(unauthorized('Invalid or expired user token'));
    req.user = { id: p.sub, email: p.email };
  }
  next();
};
const requireUser = (req, res, next) =>
  optionalUser(req, res, (err) => (err ? next(err) : req.user ? next() : next(unauthorized('Log in first (send Authorization: Bearer <token>)'))));

module.exports = { requireAdmin, requireApp, optionalUser, requireUser };
