// Document services.
//   POST /docs/parse     a PDF, Word or text file  -> its text
//   POST /docs/extract   a file (or text)          -> structured data (resume, statement, receipt, or your own fields)
//   POST /ai/extract     text                      -> structured data
// Send the file itself as the request body (fetch(url, { method: 'POST', body: file })). Max 10 MB.
const express = require('express');
const router = express.Router();
const { ah, bad, ApiError } = require('../lib/errors');
const { parseDocument, MAX_BYTES } = require('../lib/docs');
const { extract, listSchemas } = require('../lib/extract');
const ai = require('../lib/ai');
const config = require('../config');
const { limiter } = require('../lib/limits');
const { getStore, now } = require('../lib/store');

const allow = limiter(config.docsPerMinute, 60000);
// Any body that is not JSON arrives as raw bytes (that is how a file is sent).
const raw = express.raw({ type: (req) => !req.is('json'), limit: Math.ceil(MAX_BYTES * 1.1) });

function count(req, field) {
  const day = now().slice(0, 10);
  getStore().inc('_system:usage', { id: `${req.client.id}:${day}` }, field, 1, { id: `${req.client.id}:${day}`, appId: req.client.id, day, createdAt: now() }).catch(() => {});
}
function throttle(req, res) {
  if (!allow(req.client.id)) {
    res.set('Retry-After', '30');
    throw new ApiError(429, 'Too many document requests. Please wait a moment.');
  }
}

/** The file (raw body or JSON { contentBase64 }) or text ({ text }) that was sent. */
function input(req) {
  if (Buffer.isBuffer(req.body) && req.body.length) {
    return { buf: req.body, filename: String(req.get('x-filename') || req.query.filename || '') };
  }
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  if (typeof b.text === 'string' && b.text.trim()) return { buf: Buffer.from(b.text, 'utf8'), filename: String(b.filename || 'text.txt'), isText: true };
  if (typeof b.contentBase64 === 'string' && b.contentBase64) {
    if (b.contentBase64.length > MAX_BYTES * 1.4) throw new ApiError(413, `The file is too large (max ${MAX_BYTES / 1024 / 1024} MB).`);
    return { buf: Buffer.from(b.contentBase64, 'base64'), filename: String(b.filename || '') };
  }
  throw bad('Send the file as the request body, or JSON with text or contentBase64.');
}

/** Which schema to use: ?schema=resume, ?fields=a,b,c, or { schema } / { fields } in a JSON body. */
function schemaSpec(req) {
  const b = req.body && !Buffer.isBuffer(req.body) && typeof req.body === 'object' ? req.body : {};
  if (req.query.fields) return { fields: String(req.query.fields).split(',').map((s) => s.trim()).filter(Boolean) };
  if (Array.isArray(b.fields)) return { fields: b.fields };
  return req.query.schema || b.schema;
}

const meta = (d) => ({ filename: d.filename, type: d.type, ...(d.pages ? { pages: d.pages } : {}), chars: d.chars, truncated: d.truncated, warnings: d.warnings });

router.get('/docs/status', (req, res) => {
  res.json({ parse: ['pdf', 'docx', 'text'], maxMB: MAX_BYTES / 1024 / 1024, extract: listSchemas(), ai: ai.enabled(), note: 'Without AI, extraction uses simple rules and may be incomplete.' });
});

router.post('/docs/parse', raw, ah(async (req, res) => {
  const { buf, filename } = input(req);
  throttle(req, res);
  const doc = await parseDocument(buf, filename);
  count(req, 'docs');
  res.json({ ...meta(doc), text: doc.text });
}));

router.post('/docs/extract', raw, ah(async (req, res) => {
  const spec = schemaSpec(req);
  if (!spec) throw bad(`Say what to extract: ?schema=resume (or statement, receipt) or ?fields=name,date`);
  const { buf, filename } = input(req);
  throttle(req, res);
  const doc = await parseDocument(buf, filename);
  if (!doc.text) throw new ApiError(422, doc.warnings[0] || 'No text was found in this document.');
  const out = await extract(doc.text, spec);
  count(req, 'docs');
  res.json({ document: meta(doc), data: out.data, method: out.method, ...(out.model ? { model: out.model } : {}), warnings: out.warnings });
}));

router.post('/ai/extract', ah(async (req, res) => {
  const spec = schemaSpec(req);
  if (!spec) throw bad('Say what to extract: { "schema": "resume" } or { "fields": ["name", "date"] }');
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  if (text.length > 200000) throw bad('The text is too long (max 200,000 characters).');
  throttle(req, res);
  const out = await extract(text, spec);
  count(req, 'docs');
  res.json({ data: out.data, method: out.method, ...(out.model ? { model: out.model } : {}), warnings: out.warnings });
}));

module.exports = router;
