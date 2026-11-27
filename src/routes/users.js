// Sign-up / log-in for the people who use YOUR apps. Each app has its own users.
const router = require('express').Router();
const { ah, bad, notFound, unauthorized, ApiError } = require('../lib/errors');
const { requireUser } = require('../lib/middleware');
const { getStore, newId, now } = require('../lib/store');
const { hashPassword, verifyPassword, signToken } = require('../lib/security');

const ns = (req) => `app:${req.client.id}:_users`;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pub = ({ passwordHash, ...u }) => u;

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw bad('Password must be at least 8 characters');
  if (pw.length > 200) throw bad('Password is too long');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw bad('Password needs at least one letter and one number');
}
function profile(raw = {}) {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (JSON.stringify(p).length > 10000) throw bad('profile is too large');
  return p;
}

// Slow down password guessing: max 10 failed logins per email per 15 minutes.
const fails = new Map();
const failKey = (req, email) => `${req.client.id}:${email}`;
function tooMany(k) {
  const f = fails.get(k);
  return f && f.until > Date.now() && f.n >= 10;
}
function recordFail(k) {
  const f = fails.get(k);
  if (!f || f.until < Date.now()) fails.set(k, { n: 1, until: Date.now() + 15 * 60e3 });
  else f.n++;
}

const session = (req, u) => ({ token: signToken({ sub: u.id, app: req.client.id, email: u.email }), user: pub(u) });

router.post('/register', ah(async (req, res) => {
  const { email, password, name } = req.body || {};
  const e = String(email || '').trim().toLowerCase();
  if (!EMAIL.test(e)) throw bad('A valid email is required');
  checkPassword(password);
  const store = getStore();
  if (await store.findOne(ns(req), { email: e })) throw new ApiError(409, 'An account with this email already exists');
  const u = {
    id: newId(), email: e, name: String(name || '').trim().slice(0, 100),
    role: 'user', disabled: false, profile: profile(req.body.profile),
    passwordHash: hashPassword(password), createdAt: now(), updatedAt: now(),
  };
  await store.insert(ns(req), [u]);
  res.status(201).json(session(req, u));
}));

router.post('/login', ah(async (req, res) => {
  const e = String(req.body?.email || '').trim().toLowerCase();
  const k = failKey(req, e);
  if (tooMany(k)) throw new ApiError(429, 'Too many failed attempts. Try again in 15 minutes.');
  const u = await getStore().findOne(ns(req), { email: e });
  if (!u || !verifyPassword(String(req.body?.password || ''), u.passwordHash)) {
    recordFail(k);
    throw unauthorized('Wrong email or password');
  }
  if (u.disabled) throw unauthorized('This account is disabled');
  fails.delete(k);
  await getStore().update(ns(req), { id: u.id }, { lastLoginAt: now() });
  res.json(session(req, u));
}));

router.get('/me', requireUser, ah(async (req, res) => {
  const u = await getStore().findOne(ns(req), { id: req.user.id });
  if (!u || u.disabled) throw unauthorized('Account not found');
  res.json({ data: pub(u) });
}));

router.patch('/me', requireUser, ah(async (req, res) => {
  const patch = { updatedAt: now() };
  if ('name' in (req.body || {})) patch.name = String(req.body.name || '').trim().slice(0, 100);
  if ('profile' in (req.body || {})) patch.profile = profile(req.body.profile);
  const u = await getStore().update(ns(req), { id: req.user.id }, patch);
  if (!u) throw notFound('Account not found');
  res.json({ data: pub(u) });
}));

router.post('/me/password', requireUser, ah(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const u = await getStore().findOne(ns(req), { id: req.user.id });
  if (!u || !verifyPassword(String(currentPassword || ''), u.passwordHash)) throw unauthorized('Current password is wrong');
  checkPassword(newPassword);
  await getStore().update(ns(req), { id: u.id }, { passwordHash: hashPassword(newPassword), updatedAt: now() });
  res.json({ ok: true });
}));

router.delete('/me', requireUser, ah(async (req, res) => {
  await getStore().delete(ns(req), { id: req.user.id });
  res.json({ deleted: true });
}));

// App-level user management (uses only the API key — call this from your server, not a browser).
router.get('/users', ah(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const filter = req.query.q ? { $or: [{ email: { $contains: String(req.query.q) } }, { name: { $contains: String(req.query.q) } }] } : {};
  const store = getStore();
  const [rows, total] = await Promise.all([store.find(ns(req), filter, { skip: offset, limit }), store.count(ns(req), filter)]);
  res.json({ data: rows.map(pub), pagination: { total, limit, offset } });
}));
router.patch('/users/:id', ah(async (req, res) => {
  const patch = { updatedAt: now() };
  const b = req.body || {};
  if ('disabled' in b) patch.disabled = Boolean(b.disabled);
  if ('role' in b) patch.role = String(b.role).slice(0, 30);
  if ('name' in b) patch.name = String(b.name).slice(0, 100);
  if ('profile' in b) patch.profile = profile(b.profile);
  const u = await getStore().update(ns(req), { id: req.params.id }, patch);
  if (!u) throw notFound('User not found');
  res.json({ data: pub(u) });
}));
router.delete('/users/:id', ah(async (req, res) => {
  if (!(await getStore().delete(ns(req), { id: req.params.id }))) throw notFound('User not found');
  res.json({ deleted: true });
}));

module.exports = router;
