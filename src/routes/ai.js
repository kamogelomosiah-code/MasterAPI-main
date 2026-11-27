// AI service. POST /api/v1/ai/chat { prompt | messages, system?, history?, model?, maxTokens?, temperature? }
const router = require('express').Router();
const { ah, bad, ApiError } = require('../lib/errors');
const ai = require('../lib/ai');
const config = require('../config');
const { limiter } = require('../lib/limits');
const { getStore, now } = require('../lib/store');

const allow = limiter(config.aiPerMinute, 60000);
const num = (v, def, min, max, name) => {
  if (v === undefined || v === null) return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw bad(`${name} must be a number`);
  return Math.min(max, Math.max(min, n));
};

router.get('/ai/status', (req, res) => res.json({ configured: ai.enabled(), models: config.hfModels }));

router.post('/ai/chat', ah(async (req, res) => {
  if (!ai.enabled()) throw new ApiError(503, 'AI is not configured on this server. Set HF_TOKEN.');
  const b = req.body || {};
  const messages = ai.buildMessages(b);          // validate first, so bad requests never use up the allowance
  const models = ai.pickModels(b.model);
  const maxTokens = num(b.maxTokens, 512, 16, 1024, 'maxTokens');
  const temperature = num(b.temperature, 0.5, 0, 1.5, 'temperature');
  if (!allow(req.client.id)) {
    res.set('Retry-After', '30');
    throw new ApiError(429, 'Too many AI requests. Please wait a moment.');
  }
  const out = await ai.chat({ messages, models, maxTokens, temperature });
  const day = now().slice(0, 10);
  getStore().inc('_system:usage', { id: `${req.client.id}:${day}` }, 'aiChats', 1, { id: `${req.client.id}:${day}`, appId: req.client.id, day, createdAt: now() }).catch(() => {});
  res.json({ reply: out.reply, model: out.model, usage: out.usage, ms: out.ms });
}));

module.exports = router;
