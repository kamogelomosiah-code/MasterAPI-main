// Registered apps (the clients that call this API) and their API keys.
const { getStore, newId, now } = require('./store');
const { newApiKey, sha256 } = require('./security');
const { bad, notFound } = require('./errors');
const config = require('../config');

const NS = '_system:apps';
const PUBLIC = ['id', 'name', 'description', 'keyPrefix', 'active', 'rateLimitPerMinute', 'allowedOrigins', 'webhookUrl', 'createdAt', 'updatedAt', 'lastUsedAt'];
const view = (a) => a && Object.fromEntries(PUBLIC.filter((k) => k in a).map((k) => [k, a[k]]));

function checkFields(body, partial) {
  const out = {};
  if (!partial || 'name' in body) {
    const name = String(body.name || '').trim();
    if (!name || name.length > 80) throw bad('name is required (max 80 characters)');
    out.name = name;
  }
  if ('description' in body) out.description = String(body.description || '').slice(0, 500);
  if ('active' in body) out.active = Boolean(body.active);
  if ('rateLimitPerMinute' in body) {
    const n = Number(body.rateLimitPerMinute);
    if (!Number.isInteger(n) || n < 1 || n > 100000) throw bad('rateLimitPerMinute must be 1–100000');
    out.rateLimitPerMinute = n;
  }
  if ('allowedOrigins' in body) {
    if (!Array.isArray(body.allowedOrigins)) throw bad('allowedOrigins must be an array of origins');
    out.allowedOrigins = body.allowedOrigins.map(String).slice(0, 50);
  }
  if ('webhookUrl' in body) {
    const u = String(body.webhookUrl || '');
    if (u && !/^https?:\/\//i.test(u)) throw bad('webhookUrl must start with http:// or https://');
    out.webhookUrl = u;
  }
  return out;
}

async function createApp(body) {
  const fields = checkFields(body, false);
  const { key, hash, prefix } = newApiKey();
  const app = {
    id: newId(),
    description: '',
    active: true,
    rateLimitPerMinute: config.defaultRateLimitPerMinute,
    allowedOrigins: [],
    webhookUrl: '',
    ...fields,
    keyHash: hash,
    keyPrefix: prefix,
    webhookSecret: require('crypto').randomBytes(24).toString('hex'),
    createdAt: now(),
    updatedAt: now(),
  };
  await getStore().insert(NS, [app]);
  return { app: { ...view(app), webhookSecret: app.webhookSecret }, apiKey: key };
}

const listApps = async () => (await getStore().find(NS, {}, { limit: 1000 })).map(view);
async function getApp(id) {
  const a = await getStore().findOne(NS, { id });
  if (!a) throw notFound('App not found');
  return a;
}
async function updateApp(id, body) {
  const a = await getStore().update(NS, { id }, { ...checkFields(body, true), updatedAt: now() });
  if (!a) throw notFound('App not found');
  cache.clear();
  return view(a);
}
async function rotateKey(id) {
  const { key, hash, prefix } = newApiKey();
  const a = await getStore().update(NS, { id }, { keyHash: hash, keyPrefix: prefix, updatedAt: now() });
  if (!a) throw notFound('App not found');
  cache.clear();
  return { app: view(a), apiKey: key };
}
async function deleteApp(id, { purge = false } = {}) {
  const n = await getStore().delete(NS, { id });
  if (!n) throw notFound('App not found');
  cache.clear();
  if (purge) for (const ns of await getStore().namespaces(`app:${id}:`)) await getStore().drop(ns);
  return true;
}

// Short cache so every request doesn't hit the database for the key lookup.
const cache = new Map();
async function findByKey(key) {
  const hash = sha256(key);
  const hit = cache.get(hash);
  if (hit && hit.until > Date.now()) return hit.app;
  const app = await getStore().findOne(NS, { keyHash: hash });
  cache.set(hash, { app, until: Date.now() + 15000 });
  if (cache.size > 1000) cache.delete(cache.keys().next().value);
  return app;
}
const clearCache = () => cache.clear();

module.exports = { createApp, listApps, getApp, updateApp, rotateKey, deleteApp, findByKey, clearCache, view };
