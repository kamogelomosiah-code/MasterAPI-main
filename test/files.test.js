// File management: any file type, JSON files, folders, versions, conflicts, limits.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { setupEnv, client, makePdf, rawClient } = require('./helpers');

let server, base, dir, key, key2;
const call = client(() => base);
const send = rawClient(() => base);
const enc = encodeURIComponent;

before(async () => {
  dir = setupEnv({ FILE_QUOTA_MB: '0.05', FILE_MAX_MB: '0.02', FILE_MAX_COUNT: '40' }); // 50 KB quota, 20 KB per file
  await require('../src/lib/store').initStore();
  server = require('../src/app').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  key = (await call('POST', '/api/admin/apps', { admin: true, body: { name: 'Files' } })).body.apiKey;
  key2 = (await call('POST', '/api/admin/apps', { admin: true, body: { name: 'Other' } })).body.apiKey;
});
after(async () => { server.close(); await require('../src/lib/store').getStore().close(); fs.rmSync(dir, { recursive: true, force: true }); });

const up = (path, body, o = {}) => send(`/api/v1/files?path=${enc(path)}${o.q || ''}`, { key, body, type: o.type || 'application/octet-stream', headers: o.headers });

test('upload a PDF as the raw body: type from the bytes, checksum and size recorded', async () => {
  const pdf = makePdf(['hello']);
  const r = await up('docs/cv.pdf', pdf);
  assert.equal(r.status, 201);
  assert.equal(r.body.data.type, 'application/pdf');
  assert.equal(r.body.data.size, pdf.length);
  assert.equal(r.body.data.version, 1);
  assert.equal(r.body.data.sha256, require('crypto').createHash('sha256').update(pdf).digest('hex'));
  const dl = await fetch(`${base}/api/v1/files/${r.body.data.id}/content`, { headers: { 'x-api-key': key } });
  assert.equal(dl.status, 200);
  assert.deepEqual(Buffer.from(await dl.arrayBuffer()), pdf, 'bytes come back identical');
  assert.equal(dl.headers.get('content-type'), 'application/pdf');
  assert.match(dl.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''cv\.pdf/);
  assert.equal(dl.headers.get('etag'), `"${r.body.data.sha256}"`);
  const again = await fetch(`${base}/api/v1/files/${r.body.data.id}/content`, { headers: { 'x-api-key': key, 'if-none-match': dl.headers.get('etag') } });
  assert.equal(again.status, 304);
});

test('binary content survives exactly (every byte value)', async () => {
  const all = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  const r = await up('bin/all.dat', all);
  const dl = await fetch(`${base}/api/v1/files/${enc('bin/all.dat')}/content`, { headers: { 'x-api-key': key } });
  assert.deepEqual(Buffer.from(await dl.arrayBuffer()), all);
  assert.equal(r.body.data.type, 'application/octet-stream');
});

test('JSON envelope: text, json and base64 uploads', async () => {
  const t = await call('POST', '/api/v1/files', { key, body: { path: 'notes/a.txt', text: 'héllo wörld' } });
  assert.equal(t.status, 201); assert.equal(t.body.data.type, 'text/plain'); assert.equal(t.body.data.size, Buffer.byteLength('héllo wörld'));
  const j = await call('POST', '/api/v1/files', { key, body: { path: 'cfg/app.json', json: { a: 1, list: [1, 2] }, tags: ['config', 'config', 'v1'] } });
  assert.equal(j.status, 201); assert.equal(j.body.data.type, 'application/json'); assert.deepEqual(j.body.data.tags, ['config', 'v1']);
  const b = await call('POST', '/api/v1/files', { key, body: { path: 'img/dot.png', contentBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64') } });
  assert.equal(b.body.data.type, 'image/png'); assert.equal(b.body.data.size, 7);
  assert.equal((await call('POST', '/api/v1/files', { key, body: { path: 'x/e.txt', text: '' } })).body.data.size, 0, 'an empty text file is fine');
  assert.equal((await call('POST', '/api/v1/files', { key, body: { path: 'x/bad.bin', contentBase64: '***' } })).status, 400);
});

test('a JSON document can be sent as the file itself', async () => {
  const r = await send('/api/v1/files?path=data/users.json', { key, body: JSON.stringify({ users: [{ id: 1 }], path: 'not an envelope' }), type: 'application/json' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const g = await call('GET', `/api/v1/files/${enc('data/users.json')}/json`, { key });
  assert.deepEqual(g.body.data, { users: [{ id: 1 }], path: 'not an envelope' });
});

test('a path that already exists is a conflict; replacing bumps the version', async () => {
  const first = await up('v/doc.txt', Buffer.from('one'), { type: 'text/plain' });
  const dup = await up('v/doc.txt', Buffer.from('two'), { type: 'text/plain' });
  assert.equal(dup.status, 409);
  const ow = await up('v/doc.txt', Buffer.from('two'), { type: 'text/plain', q: '&overwrite=true' });
  assert.equal(ow.status, 200); assert.equal(ow.body.data.id, first.body.data.id); assert.equal(ow.body.data.version, 2);
  const put = await send(`/api/v1/files/${first.body.data.id}`, { key, method: 'PUT', body: Buffer.from('three'), type: 'text/plain' });
  assert.equal(put.status, 200); assert.equal(put.body.data.version, 3);
  const dl = await fetch(`${base}/api/v1/files/${first.body.data.id}/content`, { headers: { 'x-api-key': key } });
  assert.equal(await dl.text(), 'three');
});

test('invalid JSON is refused for .json files, and the old file is untouched', async () => {
  const bad = await up('cfg/broken.json', Buffer.from('{ nope'), { type: 'application/octet-stream' });
  assert.equal(bad.status, 422); assert.match(bad.body.error, /not valid JSON/);
  assert.equal((await call('GET', `/api/v1/files/${enc('cfg/broken.json')}`, { key })).status, 404);
  const put = await send(`/api/v1/files/${enc('cfg/app.json')}`, { key, method: 'PUT', body: Buffer.from('{ nope'), type: 'text/plain' });
  assert.equal(put.status, 422);
  assert.deepEqual((await call('GET', `/api/v1/files/${enc('cfg/app.json')}/json`, { key })).body.data, { a: 1, list: [1, 2] });
});

test('JSON merge patch: objects merge, null deletes, arrays replace', async () => {
  const p = await call('PATCH', `/api/v1/files/${enc('cfg/app.json')}/json`, { key, body: { b: { c: 1 }, a: null, list: [9] } });
  assert.equal(p.status, 200); assert.deepEqual(p.body.data, { b: { c: 1 }, list: [9] });
  const p2 = await call('PATCH', `/api/v1/files/${enc('cfg/app.json')}/json`, { key, body: { b: { d: 2 }, __proto__: { x: 1 } } });
  assert.deepEqual(p2.body.data, { b: { c: 1, d: 2 }, list: [9] });
  assert.equal(({}).x, undefined, 'no prototype pollution');
  assert.equal(p2.body.file.version, 3);
  assert.equal((await call('PATCH', `/api/v1/files/${enc('notes/a.txt')}/json`, { key, body: { a: 1 } })).status, 422, 'not a JSON file');
});

test('If-Match protects against overwriting someone else\'s change', async () => {
  const cur = (await call('GET', `/api/v1/files/${enc('cfg/app.json')}`, { key })).body.data;
  const stale = await send(`/api/v1/files/${cur.id}`, { key, method: 'PUT', body: Buffer.from('{"z":1}'), type: 'application/json', headers: { 'if-match': '"deadbeef"' } });
  assert.equal(stale.status, 412);
  const good = await send(`/api/v1/files/${cur.id}`, { key, method: 'PUT', body: Buffer.from('{"z":1}'), type: 'application/json', headers: { 'if-match': `"${cur.sha256}"` } });
  assert.equal(good.status, 200);
  assert.deepEqual((await call('GET', `/api/v1/files/${cur.id}/json`, { key })).body.data, { z: 1 });
});

test('list: prefix, folders, type, search, tags, paging', async () => {
  const all = (await call('GET', '/api/v1/files?limit=200', { key })).body;
  assert.ok(all.pagination.total >= 8);
  assert.deepEqual(all.folders, ['bin', 'cfg', 'data', 'docs', 'img', 'notes', 'v', 'x']);
  const docs = (await call('GET', '/api/v1/files?prefix=docs', { key })).body;
  assert.deepEqual(docs.data.map((f) => f.path), ['docs/cv.pdf']);
  assert.deepEqual((await call('GET', '/api/v1/files?type=application/pdf', { key })).body.data.map((f) => f.path), ['docs/cv.pdf']);
  assert.deepEqual((await call('GET', '/api/v1/files?type=image/*', { key })).body.data.map((f) => f.path), ['img/dot.png']);
  assert.deepEqual((await call('GET', '/api/v1/files?q=USERS', { key })).body.data.map((f) => f.path), ['data/users.json']);
  assert.deepEqual((await call('GET', '/api/v1/files?tag=v1', { key })).body.data.map((f) => f.path), ['cfg/app.json']);
  const pg = (await call('GET', '/api/v1/files?limit=2&offset=2', { key })).body;
  assert.equal(pg.data.length, 2); assert.equal(pg.pagination.offset, 2);
  assert.equal((await call('GET', '/api/v1/files?prefix=docs/../x', { key })).status, 400);
});

test('rename, move, tag and copy', async () => {
  const m = await call('PATCH', `/api/v1/files/${enc('notes/a.txt')}`, { key, body: { path: 'archive/2026/a.txt', tags: ['old'] } });
  assert.equal(m.status, 200); assert.equal(m.body.data.path, 'archive/2026/a.txt'); assert.equal(m.body.data.name, 'a.txt');
  assert.equal((await call('GET', `/api/v1/files/${enc('notes/a.txt')}`, { key })).status, 404);
  assert.equal((await call('PATCH', `/api/v1/files/${enc('archive/2026/a.txt')}`, { key, body: { path: 'docs/cv.pdf' } })).status, 409);
  assert.equal((await call('PATCH', `/api/v1/files/${enc('archive/2026/a.txt')}`, { key, body: {} })).status, 400);
  const c = await call('POST', `/api/v1/files/${enc('archive/2026/a.txt')}/copy`, { key, body: { path: 'copy/a.txt' } });
  assert.equal(c.status, 201); assert.notEqual(c.body.data.id, m.body.data.id);
  const dl = await fetch(`${base}/api/v1/files/${c.body.data.id}/content`, { headers: { 'x-api-key': key } });
  assert.equal(await dl.text(), 'héllo wörld');
  assert.equal((await call('POST', `/api/v1/files/${enc('archive/2026/a.txt')}/copy`, { key, body: { path: 'copy/a.txt' } })).status, 409);
});

test('paths are validated', async () => {
  for (const p of ['../etc/passwd', 'a/../b', 'a/./b', '', '   ', 'a/b\u0000c', 'what?.txt', 'x'.repeat(101), 'a/'.repeat(160) + 'f']) {
    const r = await call('POST', '/api/v1/files', { key, body: { path: p, text: 'x' } });
    assert.equal(r.status, 400, `"${p.slice(0, 20)}" -> ${r.status}`);
  }
  const ok = await call('POST', '/api/v1/files', { key, body: { path: '//lead\\and//back/slash.txt', text: 'x' } });
  assert.equal(ok.body.data.path, 'lead/and/back/slash.txt', 'cleaned');
});

test('dangerous types are never shown inline', async () => {
  const h = await call('POST', '/api/v1/files', { key, body: { path: 'web/page.html', text: '<script>alert(1)</script>' } });
  const r = await fetch(`${base}/api/v1/files/${h.body.data.id}/content?inline=1`, { headers: { 'x-api-key': key } });
  assert.match(r.headers.get('content-disposition'), /^attachment/);
  assert.match(r.headers.get('content-security-policy'), /sandbox/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const t = await fetch(`${base}/api/v1/files/${enc('lead/and/back/slash.txt')}/content?inline=1`, { headers: { 'x-api-key': key } });
  assert.match(t.headers.get('content-disposition'), /^inline/);
});

test('apps cannot see each other\'s files', async () => {
  const mine = await up('private/secret.txt', Buffer.from('mine'), { type: 'text/plain' });
  const other = await call('GET', `/api/v1/files/${mine.body.data.id}`, { key: key2 });
  assert.equal(other.status, 404);
  assert.equal((await call('GET', `/api/v1/files/${enc('private/secret.txt')}/content`, { key: key2 })).status, 404);
  assert.equal((await call('GET', '/api/v1/files', { key: key2 })).body.pagination.total, 0);
  assert.equal((await call('DELETE', `/api/v1/files/${mine.body.data.id}`, { key: key2 })).status, 404);
  assert.equal((await call('GET', '/api/v1/files', {})).status, 401);
});

test('size limit, quota and usage', async () => {
  assert.equal((await up('big/one.bin', Buffer.alloc(21 * 1024))).status, 413, 'over the 20 KB per-file limit');
  const before = (await call('GET', '/api/v1/files/usage', { key })).body;
  assert.equal(before.maxFileBytes, Math.round(0.02 * 1048576)); assert.ok(before.bytes > 0 && before.files > 5);
  // fill to the 50 KB quota
  let hit;
  for (let i = 0; i < 6 && !hit; i++) { const r = await up(`fill/${i}.bin`, Buffer.alloc(15000, i)); if (r.status === 413) hit = r; }
  assert.ok(hit, 'quota reached'); assert.match(hit.body.error, /quota/);
  const after = (await call('GET', '/api/v1/files/usage', { key })).body;
  assert.ok(after.bytes <= after.quotaBytes);
  // a failed write leaves nothing behind
  assert.equal((await call('GET', `/api/v1/files/${enc(`fill/${5}.bin`)}`, { key })).status, 404);
});

test('two uploads to one path at the same time: exactly one wins', async () => {
  const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => up('race/file.txt', Buffer.from('v' + i), { type: 'text/plain' })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409, 409, 409, 409, 409]);
  assert.equal((await call('GET', '/api/v1/files?prefix=race', { key })).body.data.length, 1);
});

test('delete a file, and a folder', async () => {
  const d = await call('DELETE', `/api/v1/files/${enc('copy/a.txt')}`, { key });
  assert.equal(d.status, 200); assert.equal(d.body.deleted, true);
  assert.equal((await call('GET', `/api/v1/files/${enc('copy/a.txt')}/content`, { key })).status, 404);
  assert.equal((await call('DELETE', '/api/v1/files?prefix=archive', { key })).status, 400, 'needs confirm');
  const f = await call('DELETE', '/api/v1/files?prefix=archive&confirm=true', { key });
  assert.equal(f.body.deleted, 1);
  assert.equal((await call('DELETE', '/api/v1/files?confirm=true', { key })).status, 400, 'no prefix = refuse to wipe everything');
  assert.equal((await call('DELETE', `/api/v1/files/${enc('nope.txt')}`, { key })).status, 404);
});

test('files are stored on disk when there is no database, and removed with the record', async () => {
  const r = await up('disk/check.txt', Buffer.from('on disk'), { type: 'text/plain' });
  const blobDir = require('path').join(require('path').dirname(process.env.DATA_FILE), 'blobs');
  const found = (d) => fs.readdirSync(d, { recursive: true }).some((f) => String(f).endsWith(r.body.data.id));
  assert.ok(found(blobDir));
  await call('DELETE', `/api/v1/files/${r.body.data.id}`, { key });
  assert.ok(!found(blobDir));
});
