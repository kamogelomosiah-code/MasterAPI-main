// File management. Any file type, folders by path, JSON files you can read and patch, versions and checksums.
//   GET    /files?prefix=&type=&q=&tag=&limit=&offset=   list (also returns the sub-folders)
//   GET    /files/usage                                  how much space is used
//   POST   /files?path=a/b.pdf   (the file as the body)  create (409 if it exists; ?overwrite=true to replace)
//   POST   /files   { path, text | json | contentBase64, contentType?, tags? }
//   GET    /files/:ref                 details       (:ref is the file id, or its path with / written as %2F)
//   GET    /files/:ref/content         download  (?inline=1 shows images, PDFs and text in the browser)
//   PUT    /files/:ref                 replace the content (send If-Match: <sha256> to avoid overwriting someone else's change)
//   PATCH  /files/:ref  { path?, tags? }       rename / move / tag
//   POST   /files/:ref/copy { path }
//   DELETE /files/:ref        and   DELETE /files?prefix=folder/&confirm=true
//   GET/PATCH /files/:ref/json         read a JSON file / merge-patch it (RFC 7396)
const express = require('express');
const router = express.Router();
const { ah, bad, ApiError } = require('../lib/errors');
const files = require('../lib/files');
const config = require('../config');
const { SAFE_INLINE } = require('../lib/filetypes');

const raw = express.raw({ type: (req) => !req.is('json'), limit: Math.ceil(config.fileMaxBytes * 1.05) });
const ENVELOPE = ['path', 'text', 'json', 'contentBase64', 'contentType', 'tags', 'overwrite'];
const isEnvelope = (b) => b && typeof b === 'object' && !Array.isArray(b) && Object.keys(b).every((k) => ENVELOPE.includes(k)) && ['text', 'json', 'contentBase64'].some((k) => k in b);
const etag = (req) => String(req.get('if-match') || '').replace(/^W\//, '').replace(/"/g, '').trim() || undefined;

/** The bytes (and details) sent with a create or replace request. */
function incoming(req) {
  const b = req.body;
  if (Buffer.isBuffer(b) && b.length) return { buf: b, headerType: req.get('content-type'), path: req.query.path, tags: undefined };
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) {
    if (isEnvelope(b)) {
      let buf;
      if (typeof b.contentBase64 === 'string') {
        if (b.contentBase64.length > config.fileMaxBytes * 1.4) throw new ApiError(413, `The file is too large (max ${config.fileMaxBytes / 1024 / 1024} MB).`);
        if (!/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(b.contentBase64)) throw bad('contentBase64 is not valid base64');
        buf = Buffer.from(b.contentBase64, 'base64');
      } else if (typeof b.text === 'string') buf = Buffer.from(b.text, 'utf8');
      else if ('json' in b) { buf = Buffer.from(JSON.stringify(b.json, null, 2), 'utf8'); }
      else throw bad('Send text, json or contentBase64');
      return { buf, headerType: b.contentType || (('json' in b) ? 'application/json' : undefined), path: b.path ?? req.query.path, tags: b.tags, overwrite: b.overwrite };
    }
    if (Object.keys(b).length || req.query.path || req.params.ref) {
      // A JSON document sent as the file itself.
      if (!Object.keys(b).length && !Array.isArray(b)) throw bad('No file content was sent');
      return { buf: Buffer.from(JSON.stringify(b, null, 2), 'utf8'), headerType: 'application/json', path: req.query.path, tags: undefined };
    }
  }
  throw bad('No file content was sent. Send the file as the request body (with ?path=) or JSON { path, text | json | contentBase64 }.');
}

router.get('/files', ah(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const r = await files.list(req.client.id, { prefix: req.query.prefix, type: req.query.type, q: req.query.q, tag: req.query.tag, limit, offset });
  res.json({ data: r.data, folders: r.folders, pagination: { total: r.total, limit, offset } });
}));
router.get('/files/usage', ah(async (req, res) => res.json(await files.usage(req.client.id))));

router.post('/files', raw, ah(async (req, res) => {
  const f = incoming(req);
  const overwrite = f.overwrite === true || req.query.overwrite === 'true';
  const r = await files.save(req.client.id, f.path, f.buf, { overwrite, headerType: f.headerType, tags: f.tags, ifMatch: etag(req) });
  res.status(r.created ? 201 : 200).json({ data: r.file, created: r.created });
}));

router.delete('/files', ah(async (req, res) => {
  if (req.query.confirm !== 'true') throw bad('Deleting a folder needs ?confirm=true');
  res.json({ deleted: await files.removeFolder(req.client.id, req.query.prefix) });
}));

router.get('/files/:ref', ah(async (req, res) => res.json({ data: files.view(await files.resolve(req.client.id, req.params.ref)) })));

router.get('/files/:ref/content', ah(async (req, res) => {
  const { meta, buf } = await files.read(req.client.id, req.params.ref);
  const tag = `"${meta.sha256}"`;
  res.set({ ETag: tag, 'Cache-Control': 'private, no-cache', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Type': meta.type });
  if (req.get('if-none-match') === tag) return res.status(304).end();
  const inline = req.query.inline === '1' && SAFE_INLINE.test(meta.type);
  res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(meta.name)}`);
  res.send(buf);
}));

router.put('/files/:ref', raw, ah(async (req, res) => {
  const cur = await files.resolve(req.client.id, req.params.ref);
  const f = incoming(req);
  const r = await files.save(req.client.id, f.path || cur.path, f.buf, { overwrite: true, headerType: f.headerType || cur.type, tags: f.tags, ifMatch: etag(req) });
  res.json({ data: r.file });
}));

router.patch('/files/:ref', ah(async (req, res) => {
  const b = req.body || {};
  if (b.path === undefined && b.tags === undefined) throw bad('Send { path } to move or rename, and/or { tags }');
  res.json({ data: await files.move(req.client.id, req.params.ref, b.path, b.tags) });
}));

router.post('/files/:ref/copy', ah(async (req, res) => res.status(201).json({ data: await files.copy(req.client.id, req.params.ref, (req.body || {}).path) })));

router.delete('/files/:ref', ah(async (req, res) => res.json({ deleted: true, data: await files.remove(req.client.id, req.params.ref) })));

router.get('/files/:ref/json', ah(async (req, res) => {
  const { meta, buf } = await files.read(req.client.id, req.params.ref);
  let value;
  try { value = JSON.parse(buf.toString('utf8')); } catch { throw new ApiError(422, 'This file is not JSON'); }
  res.set('ETag', `"${meta.sha256}"`);
  res.json({ data: value, file: files.view(meta) });
}));

router.patch('/files/:ref/json', ah(async (req, res) => {
  const patch = req.body;
  if (patch === undefined || patch === null || typeof patch !== 'object' || Array.isArray(patch)) throw bad('Send a JSON object to merge into the file. null removes a key.');
  const { meta, buf } = await files.read(req.client.id, req.params.ref);
  let current;
  try { current = JSON.parse(buf.toString('utf8')); } catch { throw new ApiError(422, 'This file is not JSON'); }
  const next = files.mergePatch(current, patch);
  const r = await files.save(req.client.id, meta.path, Buffer.from(JSON.stringify(next, null, 2), 'utf8'), { overwrite: true, headerType: 'application/json', ifMatch: etag(req) || meta.sha256 });
  res.json({ data: next, file: r.file });
}));

module.exports = router;
