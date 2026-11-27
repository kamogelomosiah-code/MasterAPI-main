// Structured extraction: text in, clean JSON out (resume, bank statement, receipt, or your own field list).
// Tries the AI first; if it is off, down, or finds nothing, simple rules answer instead.
const ai = require('./ai');
const { extractJson } = require('./json');
const { SCHEMAS, customSchema } = require('./schemas');
const { bad, ApiError } = require('./errors');

const CHUNK_CHARS = 9000;
const MAX_CHUNKS = 6;
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_ ]{0,39}$/;

/** A schema name ("resume") or { fields: ["a", "b"] }. */
function resolveSchema(spec) {
  if (typeof spec === 'string' && SCHEMAS[spec]) return { name: spec, schema: SCHEMAS[spec] };
  if (spec && typeof spec === 'object' && Array.isArray(spec.fields)) {
    const f = spec.fields.map(String);
    if (!f.length || f.length > 30 || f.some((n) => !FIELD_NAME.test(n.trim()))) throw bad('fields must be 1 to 30 short names (letters, numbers, spaces and _)');
    return { name: 'custom', schema: customSchema(f) };
  }
  throw bad(`Unknown schema. Use one of: ${Object.keys(SCHEMAS).join(', ')}, or send { "fields": ["name", "date"] }`);
}

const systemFor = (schema) =>
  `You read documents and return structured data. Reply with ONLY one JSON object in exactly this shape, with no other text. Use "", null or [] when something is not in the document. Never invent information.\n${schema.shape}`;

async function askJson(schema, text, models) {
  const messages = (extra = '') => [
    { role: 'system', content: systemFor(schema) + extra },
    { role: 'user', content: `Document:\n"""\n${text}\n"""` },
  ];
  const first = await ai.chat({ messages: messages(), models, maxTokens: 1800, temperature: 0 });
  let obj = extractJson(first.reply);
  if (obj) return { obj, model: first.model };
  const second = await ai.chat({ messages: messages('\nYour last answer was not valid JSON. Answer again with ONLY the JSON object.'), models, maxTokens: 1800, temperature: 0 });
  obj = extractJson(second.reply);
  if (!obj) throw new ApiError(502, 'The AI answered in a form that could not be read');
  return { obj, model: second.model };
}

/** Splits at line breaks into pieces of about `size` characters. */
function chunkLines(text, size) {
  const out = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur.length + line.length + 1 > size && cur) { out.push(cur); cur = ''; }
    cur += line + '\n';
  }
  if (cur.trim()) out.push(cur);
  return out;
}

async function viaAi(name, schema, text, models, ctx, warnings) {
  if (!schema.chunk) {
    const { obj, model } = await askJson(schema, text.slice(0, 14000), models);
    if (text.length > 14000) warnings.push('Only the first 14,000 characters were read.');
    return { data: schema.normalize(obj, ctx), model };
  }
  // Long documents (statements): read in pieces and join the transactions.
  let pieces = chunkLines(text, CHUNK_CHARS);
  if (pieces.length > MAX_CHUNKS) { warnings.push(`Only the first ${MAX_CHUNKS * CHUNK_CHARS / 1000}k characters were read.`); pieces = pieces.slice(0, MAX_CHUNKS); }
  const merged = { transactions: [], currency: '', openingBalance: null, closingBalance: null };
  let model = '';
  for (let i = 0; i < pieces.length; i++) {
    const r = await askJson(schema, pieces[i], models);
    model = r.model;
    const d = schema.normalize(r.obj, ctx);
    merged.transactions.push(...d.transactions);
    merged.currency = merged.currency || d.currency;
    if (i === 0 && d.openingBalance !== null) merged.openingBalance = d.openingBalance;
    if (d.closingBalance !== null) merged.closingBalance = d.closingBalance;
  }
  const seen = new Set();
  merged.transactions = merged.transactions.filter((t) => { const k = `${t.date}|${t.description}|${t.amount}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { data: merged, model };
}

/** Returns { data, method: 'ai' | 'rules', model?, warnings }. */
async function extract(text, spec) {
  const { name, schema } = resolveSchema(spec);
  text = String(text || '').trim();
  if (!text) throw bad('There is no text to read.');
  const warnings = [];
  const ctx = { year: (text.match(/\b(20\d{2})\b/) || [])[1] };
  if (ai.enabled()) {
    try {
      const { data, model } = await viaAi(name, schema, text, require('../config').hfModels, ctx, warnings);
      const empty = name === 'statement' && !data.transactions.length;
      if (!empty) return { data, method: 'ai', model, warnings };
      warnings.push('The AI found no transactions; tried simple rules instead.');
    } catch (e) {
      warnings.push(`The AI could not help (${e.message}); simple rules were used instead.`);
    }
  } else {
    warnings.push('AI is not configured on this server; simple rules were used. Results may be incomplete.');
  }
  return { data: schema.rules(text, ctx), method: 'rules', warnings };
}

const listSchemas = () => Object.entries(SCHEMAS).map(([name, s]) => ({ name, about: s.about }));

module.exports = { extract, resolveSchema, listSchemas };
