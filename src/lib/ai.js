// AI service: chat through small open models on Hugging Face.
// Only this server holds the Hugging Face token; apps just ask it to chat.
const config = require('../config');
const { ApiError, bad } = require('./errors');

const ROLES = new Set(['system', 'user', 'assistant']);
const MAX_MESSAGES = 20;
const MAX_CONTENT = 6000;
const MAX_TOTAL = 30000;

const enabled = () => Boolean(config.hfToken);

/** Builds the message list from { messages } or { prompt }, plus optional { system } and { history }. */
function buildMessages(body) {
  const { messages, prompt, system, history } = body || {};
  const out = [];
  if (system !== undefined) {
    if (typeof system !== 'string' || !system.trim()) throw bad('system must be a non-empty string');
    out.push({ role: 'system', content: system });
  }
  const turns = [];
  if (Array.isArray(history)) turns.push(...history);
  if (Array.isArray(messages)) turns.push(...messages);
  else if (typeof prompt === 'string' && prompt.trim()) turns.push({ role: 'user', content: prompt });
  if (!turns.length) throw bad('Send { prompt } or { messages: [{ role, content }] }');
  for (const m of turns) {
    if (!m || !ROLES.has(m.role) || typeof m.content !== 'string') throw bad('Each message needs a role (system, user, assistant) and text content');
    if (!m.content.trim()) continue; // empty turns are dropped, not an error
    out.push({ role: m.role, content: m.content });
  }
  // Keep the most recent turns if a long history was sent.
  const system0 = out[0]?.role === 'system' ? [out.shift()] : [];
  const recent = out.slice(-MAX_MESSAGES);
  if (!recent.length || recent[recent.length - 1].role !== 'user') throw bad('The last message must be from the user');
  const all = [...system0, ...recent];
  if (all.some((m) => m.content.length > MAX_CONTENT)) throw bad(`A message is too long (max ${MAX_CONTENT} characters)`);
  if (all.reduce((n, m) => n + m.content.length, 0) > MAX_TOTAL) throw bad('The conversation is too long');
  return all;
}

/** Models to try, in order. A requested model must be one of the configured ones. */
function pickModels(requested) {
  if (requested === undefined || requested === null || requested === '') return config.hfModels;
  if (!config.hfModels.includes(requested)) throw bad(`Unknown model. Available: ${config.hfModels.join(', ')}`);
  return [requested, ...config.hfModels.filter((m) => m !== requested)];
}

async function chat({ messages, models, maxTokens, temperature }) {
  if (!enabled()) throw new ApiError(503, 'AI is not configured on this server. Set HF_TOKEN.');
  const started = Date.now();
  const attempts = [];
  for (const model of models) {
    const left = config.aiDeadlineMs - (Date.now() - started);
    if (left < 1500) {
      attempts.push({ model, error: 'skipped: out of time' });
      break;
    }
    try {
      const r = await fetch(config.hfUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.hfToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
        signal: AbortSignal.timeout(Math.min(config.hfTimeoutMs, left)),
      });
      if (r.status === 401 || r.status === 403) {
        // The same token would be refused for every model, so stop here.
        throw new ApiError(502, 'Hugging Face refused the token. Check HF_TOKEN on the server.', { attempts: [...attempts, { model, error: `HTTP ${r.status}` }] });
      }
      if (!r.ok) {
        attempts.push({ model, error: `HTTP ${r.status}` });
        continue;
      }
      const j = await r.json().catch(() => null);
      const text = j?.choices?.[0]?.message?.content;
      if (typeof text === 'string' && text.trim()) {
        return { reply: text.trim(), model, usage: j.usage, ms: Date.now() - started, tried: attempts.length + 1 };
      }
      attempts.push({ model, error: 'empty reply' });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      attempts.push({ model, error: e.name === 'TimeoutError' ? 'timed out' : 'unreachable' });
    }
  }
  throw new ApiError(502, 'No AI model could answer right now. Please try again.', { attempts });
}

module.exports = { enabled, buildMessages, pickModels, chat };
