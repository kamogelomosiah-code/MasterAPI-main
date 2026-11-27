// Web access and the automation agent.
//   POST /web/fetch   { url }                         -> readable text of a page, JSON or PDF (+ links)
//   POST /web/extract { url, schema | fields }        -> structured data from a page
//   POST /agent/run   { goal, maxSteps?, allowWrites?, allowHosts?, saveTo? } -> { status, answer, steps }
//   /automations      saved goals you can run again: CRUD + POST /automations/:id/run
const router = require('express').Router();
const { ah, bad, notFound, ApiError } = require('../lib/errors');
const ai = require('../lib/ai');
const agent = require('../lib/agent');
const { readPage } = require('../lib/web');
const { extract } = require('../lib/extract');
const files = require('../lib/files');
const config = require('../config');
const { limiter } = require('../lib/limits');
const { getStore, newId, now } = require('../lib/store');

const allowWeb = limiter(config.webPerMinute, 60000);
const allowAgent = limiter(config.agentPerMinute, 60000);
const busy = new Set();   // one agent run at a time per app
const count = (req, field) => {
  const day = now().slice(0, 10);
  getStore().inc('_system:usage', { id: `${req.client.id}:${day}` }, field, 1, { id: `${req.client.id}:${day}`, appId: req.client.id, day, createdAt: now() }).catch(() => {});
};
const web = (req, res) => { if (!allowWeb(req.client.id)) { res.set('Retry-After', '30'); throw new ApiError(429, 'Too many web requests. Please wait a moment.'); } };

router.post('/web/fetch', ah(async (req, res) => {
  web(req, res);
  const p = await readPage(String((req.body || {}).url || ''));
  count(req, 'webFetches');
  const max = Math.min(100000, Math.max(500, Number((req.body || {}).maxChars) || 20000));
  res.json({ ...p, text: p.text.slice(0, max), truncated: p.truncated || p.text.length > max });
}));

router.post('/web/extract', ah(async (req, res) => {
  const b = req.body || {};
  if (!b.schema && !Array.isArray(b.fields)) throw bad('Say what to extract: { "schema": "resume" } or { "fields": ["price", "title"] }');
  web(req, res);
  const p = await readPage(String(b.url || ''));
  if (p.error) throw new ApiError(502, p.error);
  if (!p.text.trim()) throw new ApiError(422, 'No text was found on that page.');
  const out = await extract(`${p.title ? p.title + '\n' : ''}${p.text}`, b.schema || { fields: b.fields });
  count(req, 'webFetches');
  res.json({ url: p.url, title: p.title, data: out.data, method: out.method, ...(out.model ? { model: out.model } : {}), warnings: out.warnings });
}));

/** Checks and cleans the options of a run (shared by /agent/run and saved automations). */
function runOptions(b) {
  const goal = typeof b.goal === 'string' ? b.goal.trim() : '';
  if (!goal) throw bad('goal is required: say what the agent should do');
  if (goal.length > 3000) throw bad('goal is too long (max 3000 characters)');
  const allowHosts = Array.isArray(b.allowHosts) ? b.allowHosts.map((h) => String(h).trim().toLowerCase()).filter(Boolean).slice(0, 20) : [];
  if (b.allowWrites && !allowHosts.length) throw bad('allowWrites needs allowHosts: the hostnames the agent may send data to');
  const maxSteps = Math.min(10, Math.max(1, Number(b.maxSteps) || 6));
  return { goal, allowHosts, allowWrites: Boolean(b.allowWrites), maxSteps };
}

async function execute(req, res, opts, extra = {}) {
  if (!ai.enabled()) throw new ApiError(503, 'AI is not configured on this server. Set HF_TOKEN.');
  const models = ai.pickModels((req.body || {}).model);
  if (!allowAgent(req.client.id)) { res.set('Retry-After', '60'); throw new ApiError(429, 'Too many agent runs. Please wait a minute.'); }
  if (busy.has(req.client.id)) throw new ApiError(409, 'An agent run is already in progress for this app. Wait for it to finish.');
  busy.add(req.client.id);
  const started = Date.now();
  try {
    const r = await agent.run(req.client.id, { ...opts, models });
    count(req, 'agentRuns');
    let file;
    const save = (req.body || {}).saveTo;
    if (save && r.answer) file = (await files.save(req.client.id, String(save), Buffer.from(r.answer, 'utf8'), { overwrite: true, headerType: 'text/markdown' })).file;
    return { ...r, ...(file ? { file } : {}), ms: Date.now() - started, ...extra };
  } finally { busy.delete(req.client.id); }
}

router.post('/agent/run', ah(async (req, res) => res.json(await execute(req, res, runOptions(req.body || {})))));

// ---- Saved automations ----
const ns = (req) => `app:${req.client.id}:_automations`;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,59}$/;
const view = (d) => ({ id: d.id, name: d.name, goal: d.goal, maxSteps: d.maxSteps, allowWrites: d.allowWrites, allowHosts: d.allowHosts, lastRun: d.lastRun || null, createdAt: d.createdAt, updatedAt: d.updatedAt });
function fields(b) {
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!NAME.test(name)) throw bad('name is required (letters, numbers, spaces, - and _; up to 60 characters)');
  return { name, ...runOptions(b) };
}

router.get('/automations', ah(async (req, res) => res.json({ data: (await getStore().find(ns(req), {}, { limit: 100, sort: [['name', 1]] })).map(view) })));
router.post('/automations', ah(async (req, res) => {
  const f = fields(req.body || {});
  if ((await getStore().count(ns(req), {})) >= 100) throw new ApiError(413, 'You can save up to 100 automations.');
  if (await getStore().findOne(ns(req), { name: f.name })) throw new ApiError(409, 'An automation with that name already exists');
  const t = now(), d = { id: newId(), ...f, createdAt: t, updatedAt: t };
  await getStore().insert(ns(req), [d]);
  res.status(201).json({ data: view(d) });
}));
router.get('/automations/:id', ah(async (req, res) => {
  const d = await getStore().findOne(ns(req), { id: req.params.id });
  if (!d) throw notFound('Automation not found');
  res.json({ data: view(d) });
}));
router.put('/automations/:id', ah(async (req, res) => {
  const cur = await getStore().findOne(ns(req), { id: req.params.id });
  if (!cur) throw notFound('Automation not found');
  const f = fields(req.body || {});
  const clash = await getStore().findOne(ns(req), { name: f.name });
  if (clash && clash.id !== cur.id) throw new ApiError(409, 'An automation with that name already exists');
  res.json({ data: view(await getStore().update(ns(req), { id: cur.id }, { ...f, updatedAt: now() })) });
}));
router.delete('/automations/:id', ah(async (req, res) => {
  if (!(await getStore().delete(ns(req), { id: req.params.id }))) throw notFound('Automation not found');
  res.json({ deleted: true });
}));
router.post('/automations/:id/run', ah(async (req, res) => {
  const a = await getStore().findOne(ns(req), { id: req.params.id });
  if (!a) throw notFound('Automation not found');
  const extra = typeof (req.body || {}).input === 'string' ? `\n\nInput for this run: ${req.body.input.slice(0, 2000)}` : '';
  const out = await execute(req, res, { goal: a.goal + extra, allowHosts: a.allowHosts, allowWrites: a.allowWrites, maxSteps: a.maxSteps });
  await getStore().update(ns(req), { id: a.id }, { lastRun: { at: now(), status: out.status, answer: String(out.answer || '').slice(0, 2000), steps: out.steps.length } });
  res.json(out);
}));

module.exports = router;
