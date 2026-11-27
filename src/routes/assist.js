// Document assistant routes.
//   POST /ai/write     { task, text | fileId | url, instructions?, language?, tone? }   -> { text }
//   POST /ai/analyze   { text | fileId | url, question? }                               -> { data: { summary, keyPoints, ... } }
//   POST /ai/generate  { kind: document | slides, prompt, format?, source?, save? }     -> a real .docx / .pptx stored in Files
//   POST /docs/build   { kind, format, document | slides }                              -> the same files with no AI
const router = require('express').Router();
const { ah, bad, ApiError } = require('../lib/errors');
const ai = require('../lib/ai');
const assist = require('../lib/assist');
const { build } = require('../lib/build');
const config = require('../config');
const { limiter } = require('../lib/limits');
const { getStore, now } = require('../lib/store');

const allow = limiter(config.writePerMinute, 60000);
function gate(req, res) {
  if (!ai.enabled()) throw new ApiError(503, 'AI is not configured on this server. Set HF_TOKEN.');
  if (!allow(req.client.id)) { res.set('Retry-After', '30'); throw new ApiError(429, 'Too many requests. Please wait a moment.'); }
}
function count(req, field) {
  const day = now().slice(0, 10);
  getStore().inc('_system:usage', { id: `${req.client.id}:${day}` }, field, 1, { id: `${req.client.id}:${day}`, appId: req.client.id, day, createdAt: now() }).catch(() => {});
}

router.get('/ai/tasks', (req, res) => res.json({ write: assist.TASK_NAMES, generate: { document: ['docx', 'md', 'html', 'txt'], slides: ['pptx', 'md'] } }));

router.post('/ai/write', ah(async (req, res) => {
  const b = { ...(req.body || {}) };
  if (!ai.enabled()) throw new ApiError(503, 'AI is not configured on this server. Set HF_TOKEN.');
  const inp = await assist.inputText(req.client.id, b, { required: false });
  b._text = inp.text; b._warnings = inp.warnings;
  ai.pickModels(b.model);
  gate(req, res);
  const out = await assist.write(b);
  count(req, 'aiWrites');
  res.json(out);
}));

router.post('/ai/analyze', ah(async (req, res) => {
  const b = { ...(req.body || {}) };
  if (!ai.enabled()) throw new ApiError(503, 'AI is not configured on this server. Set HF_TOKEN.');
  const inp = await assist.inputText(req.client.id, b);
  b._text = inp.text; b._warnings = inp.warnings; ai.pickModels(b.model);
  gate(req, res);
  const out = await assist.analyze(b);
  count(req, 'aiWrites');
  res.json({ ...out, source: inp.from });
}));

router.post('/ai/generate', ah(async (req, res) => {
  const b = req.body || {};
  ai.pickModels(b.model);
  gate(req, res);
  const out = await assist.generate(req.client.id, b);
  count(req, 'aiWrites');
  res.status(out.file ? 201 : 200).json(out);
}));

router.post('/docs/build', ah(async (req, res) => {
  const b = req.body || {};
  const kind = b.kind;
  const format = b.format || (kind === 'slides' ? 'pptx' : 'docx');
  let built;
  try { built = await build(kind, format, kind === 'slides' ? b.slides ?? b.structure : b.document ?? b.structure); } catch (e) { if (e.status === 400) throw bad(e.message); throw e; }
  const out = await assist.finish(req.client.id, b, built, kind, null, []);
  const { model, ...rest } = out;
  res.status(rest.file ? 201 : 200).json(rest);
}));

module.exports = router;
