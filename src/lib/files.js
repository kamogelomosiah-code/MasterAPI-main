// File management for one app: any file type, folders by path, versions, checksums, quota.
const crypto = require('crypto');
const config = require('../config');
const { getStore, newId, now } = require('./store');
const blobs = require('./blobs');
const { contentType, isJson } = require('./filetypes');
const { ApiError, bad, notFound } = require('./errors');

const ns = (appId) => `app:${appId}:_files`;
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** One writer at a time per app, so two uploads to the same path or the quota check cannot race. */
const locks = new Map();
function locked(appId, fn) {
  const prev = locks.get(appId) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  locks.set(appId, tail);
  tail.then(() => locks.get(appId) === tail && locks.delete(appId));
  return run;
}

/** Cleans a path like "docs//cv.pdf" -> "docs/cv.pdf"; rejects anything odd. */
function cleanPath(p) {
  if (typeof p !== 'string' || !p.trim()) throw bad('path is required, for example "docs/cv.pdf"');
  const parts = p.replace(/\\/g, '/').split('/').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw bad('path is required');
  for (const s of parts) {
    if (s === '.' || s === '..') throw bad('path cannot contain . or ..');
    if (/[\u0000-\u001f<>:"|?*]/.test(s)) throw bad('path contains characters that are not allowed');
    if (s.length > 100) throw bad('Each part of a path can be up to 100 characters');
  }
  const out = parts.join('/');
  if (out.length > 300) throw bad('path is too long (max 300 characters)');
  return out;
}
const cleanPrefix = (p) => (p ? cleanPath(p) + '/' : '');

const view = (d) => ({ id: d.id, path: d.path, name: d.name, size: d.size, type: d.type, sha256: d.sha256, version: d.version, tags: d.tags || [], createdAt: d.createdAt, updatedAt: d.updatedAt });

async function all(appId) {
  return getStore().find(ns(appId), {}, { limit: config.fileMaxCount + 50, sort: [['path', 1]] });
}
async function byPath(appId, p) { return getStore().findOne(ns(appId), { path: p }); }
/** A file by id, or by path (any ref that is not an id is read as a path). */
async function resolve(appId, ref) {
  const d = UUID.test(ref) ? await getStore().findOne(ns(appId), { id: ref }) : await byPath(appId, cleanPath(ref));
  if (!d) throw notFound('File not found');
  return d;
}

function tagsOf(t) {
  if (t === undefined) return undefined;
  if (!Array.isArray(t) || t.length > 20 || t.some((x) => typeof x !== 'string' || !x.trim() || x.length > 40)) throw bad('tags must be up to 20 short strings');
  return [...new Set(t.map((x) => x.trim()))];
}

/** Checks the bytes match what the file claims to be (valid JSON for .json). */
function validate(type, name, buf) {
  if (isJson(type, name)) {
    try { JSON.parse(buf.toString('utf8')); } catch (e) { throw new ApiError(422, `This is not valid JSON: ${e.message}`); }
  }
}

async function usage(appId) {
  const rows = await all(appId);
  return { files: rows.length, bytes: rows.reduce((n, d) => n + d.size, 0), quotaBytes: config.fileQuotaBytes, maxFileBytes: config.fileMaxBytes, maxFiles: config.fileMaxCount };
}

/**
 * Creates or replaces a file. opts: { overwrite, ifMatch, headerType, tags }.
 * Replacing keeps the id and bumps the version.
 */
function save(appId, rawPath, buf, opts = {}) {
  const p = cleanPath(rawPath);
  if (!Buffer.isBuffer(buf)) throw bad('No file content was sent');
  if (buf.length > config.fileMaxBytes) throw new ApiError(413, `The file is too large (max ${config.fileMaxBytes / 1024 / 1024} MB).`);
  const type = contentType(opts.headerType, p, buf);
  validate(type, p, buf);
  const tags = tagsOf(opts.tags);
  return locked(appId, async () => {
    const store = getStore();
    const existing = await byPath(appId, p);
    const hash = sha(buf);
    if (existing) {
      if (!opts.overwrite) throw new ApiError(409, `A file already exists at "${p}". Use PUT to replace it, or ?overwrite=true.`);
      if (opts.ifMatch && opts.ifMatch !== '*' && opts.ifMatch !== hash && opts.ifMatch !== existing.sha256) throw new ApiError(412, 'The file changed since you read it (If-Match did not match). Read it again and retry.', { current: existing.sha256 });
    } else if (opts.ifMatch && opts.ifMatch !== '*') {
      throw new ApiError(412, 'There is no file at that path to match.');
    }
    const u = await usage(appId);
    if (!existing && u.files >= config.fileMaxCount) throw new ApiError(413, `File limit reached (${config.fileMaxCount} files).`);
    if (u.bytes - (existing?.size || 0) + buf.length > config.fileQuotaBytes) throw new ApiError(413, `Storage quota exceeded (${Math.round(config.fileQuotaBytes / 1024 / 1024)} MB).`);
    const id = existing?.id || newId();
    await blobs.put(appId, id, buf);          // bytes first: a failure leaves no dangling record
    const t = now();
    const fields = { path: p, name: p.split('/').pop(), size: buf.length, type, sha256: hash, tags: tags ?? existing?.tags ?? [], updatedAt: t };
    if (existing) {
      const d = await store.update(ns(appId), { id }, { ...fields, version: existing.version + 1 });
      return { file: view(d), created: false };
    }
    await store.insert(ns(appId), [{ id, ...fields, version: 1, createdAt: t }]);
    return { file: view({ id, ...fields, version: 1, createdAt: t }), created: true };
  });
}

async function read(appId, ref) {
  const d = await resolve(appId, ref);
  const buf = await blobs.get(appId, d.id);
  if (!buf) throw new ApiError(500, 'The file record exists but its content is missing');
  return { meta: d, buf };
}

function move(appId, ref, newPath, tags) {
  return locked(appId, async () => {
    const d = await resolve(appId, ref);
    const patch = { updatedAt: now() };
    if (newPath !== undefined) {
      const p = cleanPath(newPath);
      const clash = await byPath(appId, p);
      if (clash && clash.id !== d.id) throw new ApiError(409, `A file already exists at "${p}"`);
      Object.assign(patch, { path: p, name: p.split('/').pop() });
    }
    const t = tagsOf(tags);
    if (t) patch.tags = t;
    return view(await getStore().update(ns(appId), { id: d.id }, patch));
  });
}

function copy(appId, ref, newPath) {
  return locked(appId, async () => {
    const { meta, buf } = await read(appId, ref);
    const p = cleanPath(newPath);
    if (await byPath(appId, p)) throw new ApiError(409, `A file already exists at "${p}"`);
    const u = await usage(appId);
    if (u.files >= config.fileMaxCount || u.bytes + buf.length > config.fileQuotaBytes) throw new ApiError(413, 'Storage limit reached.');
    const id = newId(), t = now();
    await blobs.put(appId, id, buf);
    const rec = { id, path: p, name: p.split('/').pop(), size: meta.size, type: meta.type, sha256: meta.sha256, tags: meta.tags || [], version: 1, createdAt: t, updatedAt: t };
    await getStore().insert(ns(appId), [rec]);
    return view(rec);
  });
}

function remove(appId, ref) {
  return locked(appId, async () => {
    const d = await resolve(appId, ref);
    await getStore().delete(ns(appId), { id: d.id });
    await blobs.del(appId, d.id);
    return view(d);
  });
}
/** Deletes every file whose path starts with `prefix/`. */
function removeFolder(appId, prefix) {
  const pre = cleanPrefix(prefix);
  if (!pre) throw bad('A folder prefix is required');
  return locked(appId, async () => {
    const rows = (await all(appId)).filter((d) => d.path.startsWith(pre));
    for (const d of rows) { await getStore().delete(ns(appId), { id: d.id }); await blobs.del(appId, d.id); }
    return rows.length;
  });
}

/** Lists files under a prefix, plus the sub-folders directly inside it. */
async function list(appId, { prefix = '', type, q, tag, limit = 50, offset = 0 } = {}) {
  const pre = cleanPrefix(prefix);
  let rows = (await all(appId)).filter((d) => d.path.startsWith(pre));
  const folders = new Set();
  for (const d of rows) { const rest = d.path.slice(pre.length); if (rest.includes('/')) folders.add(pre + rest.split('/')[0]); }
  if (type) rows = rows.filter((d) => (type.endsWith('/*') ? d.type.startsWith(type.slice(0, -1)) : d.type === type));
  if (tag) rows = rows.filter((d) => (d.tags || []).includes(tag));
  if (q) rows = rows.filter((d) => d.path.toLowerCase().includes(String(q).toLowerCase()));
  return { total: rows.length, data: rows.slice(offset, offset + limit).map(view), folders: [...folders].sort() };
}

/** RFC 7396 JSON merge patch: objects merge, null deletes a key, anything else replaces. */
function mergePatch(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (v === null) delete out[k]; else out[k] = mergePatch(out[k], v);
  }
  return out;
}

module.exports = { save, read, move, copy, remove, removeFolder, list, usage, resolve, view, mergePatch, cleanPath, UUID };
