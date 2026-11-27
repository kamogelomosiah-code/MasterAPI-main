// Small extra services: key-value settings and counters.
const router = require('express').Router();
const { ah, bad, notFound } = require('../lib/errors');
const { getStore, now } = require('../lib/store');

const KEY = /^[A-Za-z0-9_.:-]{1,128}$/;
const checkKey = (k) => {
  if (!KEY.test(k)) throw bad('Keys use letters, numbers and _ . : - (max 128)');
  return k;
};

// ---- Key-value store: handy for app settings, feature flags, cached JSON ----
const kv = (req) => `app:${req.client.id}:_kv`;
router.get('/kv', ah(async (req, res) => {
  const rows = await getStore().find(kv(req), req.query.prefix ? { id: { $startsWith: String(req.query.prefix) } } : {}, { sort: [['id', 1]], limit: 1000 });
  res.json({ data: Object.fromEntries(rows.map((r) => [r.id, r.value])) });
}));
router.get('/kv/:key', ah(async (req, res) => {
  const r = await getStore().findOne(kv(req), { id: checkKey(req.params.key) });
  if (!r) throw notFound('Key not found');
  res.json({ key: r.id, value: r.value, updatedAt: r.updatedAt });
}));
router.put('/kv/:key', ah(async (req, res) => {
  const key = checkKey(req.params.key);
  if (!req.body || !('value' in req.body)) throw bad('Send { "value": ... }');
  const store = getStore();
  const t = now();
  const done = await store.update(kv(req), { id: key }, { value: req.body.value, updatedAt: t });
  if (!done) await store.insert(kv(req), [{ id: key, value: req.body.value, createdAt: t, updatedAt: t }]);
  res.json({ key, value: req.body.value, updatedAt: t });
}));
router.delete('/kv/:key', ah(async (req, res) => {
  if (!(await getStore().delete(kv(req), { id: checkKey(req.params.key) }))) throw notFound('Key not found');
  res.json({ deleted: true });
}));

// ---- Counters: page views, likes, downloads ----
const ctr = (req) => `app:${req.client.id}:_counters`;
router.get('/counters', ah(async (req, res) => {
  const rows = await getStore().find(ctr(req), {}, { sort: [['id', 1]], limit: 1000 });
  res.json({ data: Object.fromEntries(rows.map((r) => [r.id, r.value])) });
}));
router.get('/counters/:name', ah(async (req, res) => {
  const r = await getStore().findOne(ctr(req), { id: checkKey(req.params.name) });
  res.json({ name: req.params.name, value: r?.value || 0 });
}));
router.post('/counters/:name/increment', ah(async (req, res) => {
  const by = req.body?.by === undefined ? 1 : Number(req.body.by);
  if (!Number.isFinite(by) || Math.abs(by) > 1e6) throw bad('by must be a number');
  const name = checkKey(req.params.name);
  const r = await getStore().inc(ctr(req), { id: name }, 'value', by, { id: name, createdAt: now() });
  res.json({ name, value: r.value });
}));
router.delete('/counters/:name', ah(async (req, res) => {
  await getStore().delete(ctr(req), { id: checkKey(req.params.name) });
  res.json({ deleted: true });
}));

module.exports = router;
