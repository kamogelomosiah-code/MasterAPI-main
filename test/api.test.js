// End-to-end tests against a real server using the JSON store in a temp file.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'masterapi-'));
process.env.DATA_FILE = path.join(dir, 'store.json');
process.env.MASTER_KEY = 'test-master-key-123456';
process.env.TOKEN_SECRET = 'test-token-secret-123456';
// Set TEST_MONGODB_URI to run the same tests against a real MongoDB (uses a throwaway database).
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI || '';
process.env.MONGODB_DB = `masterapi_test_${Date.now()}`;
process.env.RATE_LIMIT_PER_MINUTE = '1000';

const { initStore, getStore } = require('../src/lib/store');
const { createApp } = require('../src/app');

let base, server, key, appId;
const call = async (method, url, { body, key: k = key, token, admin } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (k) headers['x-api-key'] = k;
  if (token) headers.authorization = `Bearer ${token}`;
  if (admin) headers.authorization = `Bearer ${process.env.MASTER_KEY}`;
  const r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
};

before(async () => {
  await initStore();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  if (getStore().kind === 'mongodb') await getStore().db.dropDatabase();
  await getStore().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('health and docs are public', async () => {
  assert.equal((await call('GET', '/api/health', { key: null })).body.status, 'ok');
  assert.ok((await call('GET', '/api/docs', { key: null })).body.endpoints.data.length > 5);
});

test('admin needs the master key', async () => {
  assert.equal((await call('GET', '/api/admin/apps', { key: null })).status, 401);
  const r = await fetch(base + '/api/admin/apps', { headers: { authorization: 'Bearer wrong' } });
  assert.equal(r.status, 401);
});

test('admin creates an app and gets a key once', async () => {
  const r = await call('POST', '/api/admin/apps', { key: null, admin: true, body: { name: 'Test app' } });
  assert.equal(r.status, 201);
  assert.match(r.body.apiKey, /^mk_live_[0-9a-f]{48}$/);
  assert.equal(r.body.data.keyHash, undefined);
  key = r.body.apiKey;
  appId = r.body.data.id;
  const list = await call('GET', '/api/admin/apps', { key: null, admin: true });
  assert.equal(list.body.data.length, 1);
  assert.ok(!JSON.stringify(list.body).includes(key), 'key is never listed');
  assert.equal((await call('POST', '/api/admin/apps', { key: null, admin: true, body: {} })).status, 400);
});

test('app routes need a valid key', async () => {
  assert.equal((await call('GET', '/api/v1/me', { key: null })).status, 401);
  assert.equal((await call('GET', '/api/v1/me', { key: 'mk_live_nope' })).status, 401);
  const me = await call('GET', '/api/v1/me');
  assert.equal(me.body.data.name, 'Test app');
  assert.ok(me.headers.get('x-ratelimit-limit'));
});

test('CRUD on a collection', async () => {
  const c = await call('POST', '/api/v1/data/products', { body: { name: 'Pen', price: 10, tags: ['office'] } });
  assert.equal(c.status, 201);
  const id = c.body.data.id;
  assert.ok(c.body.data.createdAt);
  assert.equal((await call('GET', `/api/v1/data/products/${id}`)).body.data.name, 'Pen');
  const p = await call('PATCH', `/api/v1/data/products/${id}`, { body: { price: 12, tags: null } });
  assert.equal(p.body.data.price, 12);
  assert.equal(p.body.data.tags, undefined);
  assert.equal(p.body.data.name, 'Pen');
  const u = await call('PUT', `/api/v1/data/products/${id}`, { body: { name: 'Pencil' } });
  assert.equal(u.body.data.name, 'Pencil');
  assert.equal(u.body.data.price, undefined);
  assert.equal(u.body.data.id, id);
  assert.equal((await call('DELETE', `/api/v1/data/products/${id}`)).body.deleted, true);
  assert.equal((await call('GET', `/api/v1/data/products/${id}`)).status, 404);
  assert.equal((await call('DELETE', `/api/v1/data/products/${id}`)).status, 404);
});

test('bulk create, filter, sort, page, count', async () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ name: `Item ${i}`, n: i, kind: i % 2 ? 'odd' : 'even' }));
  const r = await call('POST', '/api/v1/data/items', { body: items });
  assert.equal(r.body.created, 30);
  const page = await call('GET', '/api/v1/data/items?limit=10&page=2&sort=n');
  assert.equal(page.body.data[0].n, 10);
  assert.equal(page.body.pagination.total, 30);
  assert.equal(page.body.pagination.pages, 3);
  assert.equal((await call('GET', '/api/v1/data/items?kind=odd&limit=100')).body.data.length, 15);
  assert.equal((await call('GET', `/api/v1/data/items/count?where=${encodeURIComponent('{"n":{"$gte":25}}')}`)).body.count, 5);
  const q = await call('POST', '/api/v1/data/items/query', { body: { filter: { $or: [{ n: 1 }, { name: { $contains: 'item 2' } }] }, sort: '-n', fields: ['n'] } });
  assert.deepEqual(q.body.data.map((d) => d.n), [29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 2, 1].slice(0, 12).filter((n) => n === 1 || String(n).startsWith('2')).sort((a, b) => b - a));
  assert.equal(q.body.data[0].name, undefined, 'fields limits output');
  const bu = await call('PATCH', '/api/v1/data/items', { body: { filter: { kind: 'even' }, set: { flagged: true } } });
  assert.equal(bu.body.updated, 15);
  const bd = await call('DELETE', '/api/v1/data/items', { body: { filter: { flagged: true } } });
  assert.equal(bd.body.deleted, 15);
  const cols = await call('GET', '/api/v1/data');
  assert.deepEqual(cols.body.data, [{ name: 'items', count: 15 }]);
});

test('rejects unsafe input', async () => {
  assert.equal((await call('GET', `/api/v1/data/items?where=${encodeURIComponent('{"$where":"1"}')}`)).status, 400);
  assert.equal((await call('GET', `/api/v1/data/items?where=${encodeURIComponent('{"n":{"$regex":".*"}}')}`)).status, 400);
  assert.equal((await call('GET', '/api/v1/data/_users')).status, 400, 'internal collections are hidden');
  assert.equal((await call('POST', '/api/v1/data/items', { body: 'x' })).status, 400);
  const r = await fetch(base + '/api/v1/data/items', { method: 'POST', headers: { 'x-api-key': key, 'content-type': 'application/json' }, body: '{bad' });
  assert.equal(r.status, 400);
  const c = await call('POST', '/api/v1/data/items', { body: { id: 'fixed', createdAt: 'x', ownerId: 'hacker', $set: 1 } });
  assert.equal(c.body.data.id, 'fixed');
  assert.notEqual(c.body.data.createdAt, 'x');
  assert.equal(c.body.data.ownerId, undefined);
  assert.equal((await call('POST', '/api/v1/data/items', { body: { id: 'fixed' } })).status, 400, 'duplicate id');
});

test('user accounts', async () => {
  const bad = await call('POST', '/api/v1/auth/register', { body: { email: 'a@b.co', password: 'short' } });
  assert.equal(bad.status, 400);
  const r = await call('POST', '/api/v1/auth/register', { body: { email: 'Ann@Example.com', password: 'secret123', name: 'Ann' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.email, 'ann@example.com');
  assert.equal(r.body.user.passwordHash, undefined);
  assert.equal((await call('POST', '/api/v1/auth/register', { body: { email: 'ann@example.com', password: 'secret123' } })).status, 409);
  assert.equal((await call('POST', '/api/v1/auth/login', { body: { email: 'ann@example.com', password: 'wrong1234' } })).status, 401);
  const l = await call('POST', '/api/v1/auth/login', { body: { email: 'ann@example.com', password: 'secret123' } });
  const token = l.body.token;
  assert.equal((await call('GET', '/api/v1/auth/me', { token })).body.data.name, 'Ann');
  assert.equal((await call('GET', '/api/v1/auth/me')).status, 401);
  assert.equal((await call('GET', '/api/v1/auth/me', { token: token + 'x' })).status, 401);
  assert.equal((await call('PATCH', '/api/v1/auth/me', { token, body: { profile: { city: 'Joburg' } } })).body.data.profile.city, 'Joburg');

  // Documents created by a user are theirs
  await call('POST', '/api/v1/data/notes', { token, body: { text: 'mine' } });
  await call('POST', '/api/v1/data/notes', { body: { text: 'not mine' } });
  const mine = await call('GET', '/api/v1/data/notes?mine=true', { token });
  assert.deepEqual(mine.body.data.map((d) => d.text), ['mine']);

  assert.equal((await call('POST', '/api/v1/auth/me/password', { token, body: { currentPassword: 'nope', newPassword: 'newpass123' } })).status, 401);
  assert.equal((await call('POST', '/api/v1/auth/me/password', { token, body: { currentPassword: 'secret123', newPassword: 'newpass123' } })).status, 200);
  assert.equal((await call('POST', '/api/v1/auth/login', { body: { email: 'ann@example.com', password: 'newpass123' } })).status, 200);

  const users = await call('GET', '/api/v1/auth/users?q=ann');
  assert.equal(users.body.data.length, 1);
  const uid = users.body.data[0].id;
  await call('PATCH', `/api/v1/auth/users/${uid}`, { body: { disabled: true } });
  assert.equal((await call('POST', '/api/v1/auth/login', { body: { email: 'ann@example.com', password: 'newpass123' } })).status, 401);
});

test('key-value and counters', async () => {
  assert.equal((await call('GET', '/api/v1/kv/theme')).status, 404);
  await call('PUT', '/api/v1/kv/theme', { body: { value: { dark: true } } });
  await call('PUT', '/api/v1/kv/theme', { body: { value: { dark: false } } });
  assert.deepEqual((await call('GET', '/api/v1/kv/theme')).body.value, { dark: false });
  assert.deepEqual((await call('GET', '/api/v1/kv')).body.data, { theme: { dark: false } });
  assert.equal((await call('DELETE', '/api/v1/kv/theme')).body.deleted, true);

  await call('POST', '/api/v1/counters/views/increment');
  const c = await call('POST', '/api/v1/counters/views/increment', { body: { by: 5 } });
  assert.equal(c.body.value, 6);
  assert.equal((await call('GET', '/api/v1/counters/views')).body.value, 6);
});

test('AI reports when not configured', async () => {
  assert.equal((await call('POST', '/api/v1/ai/chat', { body: { prompt: 'hi' } })).status, 503);
});

test('apps are isolated from each other', async () => {
  const other = await call('POST', '/api/admin/apps', { key: null, admin: true, body: { name: 'Other' } });
  const k2 = other.body.apiKey;
  assert.equal((await call('GET', '/api/v1/data/items', { key: k2 })).body.pagination.total, 0);
  assert.equal((await call('GET', '/api/v1/auth/users', { key: k2 })).body.data.length, 0);
  // A user token from app 1 doesn't work for app 2
  const t = (await call('POST', '/api/v1/auth/register', { body: { email: 'zed@example.com', password: 'secret123' } })).body.token;
  assert.equal((await call('GET', '/api/v1/auth/me', { key: k2, token: t })).status, 401);
});

test('admin can disable, rotate key and delete', async () => {
  await call('PATCH', `/api/admin/apps/${appId}`, { key: null, admin: true, body: { active: false } });
  assert.equal((await call('GET', '/api/v1/me')).status, 403);
  await call('PATCH', `/api/admin/apps/${appId}`, { key: null, admin: true, body: { active: true } });
  const rot = await call('POST', `/api/admin/apps/${appId}/rotate-key`, { key: null, admin: true });
  assert.equal((await call('GET', '/api/v1/me')).status, 401, 'old key stops working');
  key = rot.body.apiKey;
  assert.equal((await call('GET', '/api/v1/me')).status, 200);
  const info = await call('GET', `/api/admin/apps/${appId}`, { key: null, admin: true });
  assert.ok(info.body.data.collections.includes('items'));
  assert.ok(info.body.data.usage[0].requests > 0);
  await call('DELETE', `/api/admin/apps/${appId}?purge=true`, { key: null, admin: true });
  assert.equal((await call('GET', '/api/v1/me')).status, 401);
});

test('rate limit per app', async () => {
  const a = await call('POST', '/api/admin/apps', { key: null, admin: true, body: { name: 'Tiny', rateLimitPerMinute: 3 } });
  const k = a.body.apiKey;
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await call('GET', '/api/v1/me', { key: k })).status);
  assert.deepEqual(codes, [200, 200, 200, 429]);
});

test('webhooks fire signed events', async () => {
  const crypto = require('crypto');
  const http = require('http');
  const got = [];
  const hook = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { got.push({ body: b, sig: req.headers['x-masterapi-signature'] }); res.end('ok'); });
  }).listen(0);
  const a = await call('POST', '/api/admin/apps', { key: null, admin: true, body: { name: 'Hooked', webhookUrl: `http://127.0.0.1:${hook.address().port}/` } });
  await call('POST', '/api/v1/data/orders', { key: a.body.apiKey, body: { total: 5 } });
  for (let i = 0; i < 50 && !got.length; i++) await new Promise((r) => setTimeout(r, 20));
  hook.close();
  assert.equal(JSON.parse(got[0].body).event, 'document.created');
  assert.equal(got[0].sig, crypto.createHmac('sha256', a.body.data.webhookSecret).update(got[0].body).digest('hex'));
});

test('data survives a restart (JSON store)', { skip: !!process.env.TEST_MONGODB_URI }, async () => {
  getStore().flush();
  const saved = JSON.parse(fs.readFileSync(process.env.DATA_FILE, 'utf8'));
  assert.ok(Object.keys(saved).some((k) => k.endsWith(':orders')));
});
