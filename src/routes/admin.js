// Admin: manage the apps that may use this API. Protected by MASTER_KEY.
const router = require('express').Router();
const { ah } = require('../lib/errors');
const { requireAdmin } = require('../lib/middleware');
const apps = require('../lib/apps');
const { getStore } = require('../lib/store');

router.use(requireAdmin);

router.get('/apps', ah(async (req, res) => res.json({ data: await apps.listApps() })));
router.post('/apps', ah(async (req, res) => {
  const { app, apiKey } = await apps.createApp(req.body || {});
  res.status(201).json({ data: app, apiKey, note: 'Save this API key now — it is not shown again.' });
}));
router.get('/apps/:id', ah(async (req, res) => {
  const app = await apps.getApp(req.params.id);
  const store = getStore();
  const collections = (await store.namespaces(`app:${app.id}:`)).map((ns) => ns.split(':')[2]).filter((c) => !c.startsWith('_'));
  const usage = await store.find('_system:usage', { appId: app.id }, { sort: [['day', -1]], limit: 30 });
  res.json({ data: { ...apps.view(app), webhookSecret: app.webhookSecret, collections, usage: usage.map((u) => ({ day: u.day, requests: u.requests })) } });
}));
router.patch('/apps/:id', ah(async (req, res) => res.json({ data: await apps.updateApp(req.params.id, req.body || {}) })));
router.post('/apps/:id/rotate-key', ah(async (req, res) => {
  const { app, apiKey } = await apps.rotateKey(req.params.id);
  res.json({ data: app, apiKey, note: 'The old key stops working immediately.' });
}));
router.delete('/apps/:id', ah(async (req, res) => {
  await apps.deleteApp(req.params.id, { purge: req.query.purge === 'true' });
  res.json({ deleted: true });
}));

module.exports = router;
