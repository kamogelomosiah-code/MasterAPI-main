// Generic CRUD for any collection an app wants. Each app's data is kept separate.
const router = require('express').Router();
const { ah, bad, notFound } = require('../lib/errors');
const { optionalUser } = require('../lib/middleware');
const { getStore, newId, now } = require('../lib/store');
const { filterFromQuery, validateFilter, parseSort, FIELD } = require('../lib/query');
const { fire } = require('../lib/webhooks');

const RESERVED = ['limit', 'offset', 'page', 'sort', 'fields', 'mine', 'count'];
const PROTECTED = ['id', 'createdAt', 'updatedAt', 'ownerId'];
const MAX_BATCH = 1000;

router.use(optionalUser);

const ns = (req) => {
  const c = req.params.collection;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(c) || c.includes('__')) throw bad('Collection names use letters, numbers, _ and - (max 64, not starting with _)');
  return `app:${req.client.id}:${c}`;
};

function body(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('Send a JSON object');
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (PROTECTED.includes(k) || k.startsWith('$') || k.startsWith('_')) continue;
    if (!FIELD.test(k)) throw bad(`Invalid field name: ${k}`);
    out[k] = v;
  }
  return out;
}

function newDoc(req, raw) {
  const id = raw && typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id) ? raw.id : newId();
  const t = now();
  return { id, ...body(raw), ...(req.user ? { ownerId: req.user.id } : {}), createdAt: t, updatedAt: t };
}

/** ?mine=true limits to documents created by the logged-in user. */
function scope(req, filter) {
  if (req.query.mine === 'true') {
    if (!req.user) throw bad('mine=true needs a logged-in user token');
    return { ...filter, ownerId: req.user.id };
  }
  return filter;
}

function paging(q) {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 200);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  const offset = q.offset !== undefined ? Math.max(parseInt(q.offset, 10) || 0, 0) : (page - 1) * limit;
  return { limit, offset };
}

// List the app's collections
router.get('/', ah(async (req, res) => {
  const store = getStore();
  const names = (await store.namespaces(`app:${req.client.id}:`)).map((n) => n.split(':')[2]).filter((c) => !c.startsWith('_'));
  const data = await Promise.all(names.sort().map(async (name) => ({ name, count: await store.count(`app:${req.client.id}:${name}`) })));
  res.json({ data });
}));

// List / search
router.get('/:collection', ah(async (req, res) => {
  const filter = scope(req, filterFromQuery(req.query, RESERVED));
  const { limit, offset } = paging(req.query);
  const sort = parseSort(req.query.sort);
  const fields = req.query.fields ? String(req.query.fields).split(',').filter((f) => FIELD.test(f)) : undefined;
  const store = getStore();
  const [data, total] = await Promise.all([store.find(ns(req), filter, { sort, skip: offset, limit, fields }), store.count(ns(req), filter)]);
  res.json({ data, pagination: { total, limit, offset, page: Math.floor(offset / limit) + 1, pages: Math.ceil(total / limit), hasMore: offset + data.length < total } });
}));

// Advanced search with a JSON body: { filter, sort, limit, offset, fields }
router.post('/:collection/query', ah(async (req, res) => {
  const b = req.body || {};
  const filter = scope(req, validateFilter(b.filter || {}));
  const { limit, offset } = paging(b);
  const store = getStore();
  const [data, total] = await Promise.all([
    store.find(ns(req), filter, { sort: parseSort(Array.isArray(b.sort) ? b.sort.join(',') : b.sort), skip: offset, limit, fields: b.fields }),
    store.count(ns(req), filter),
  ]);
  res.json({ data, pagination: { total, limit, offset, hasMore: offset + data.length < total } });
}));

router.get('/:collection/count', ah(async (req, res) => {
  res.json({ count: await getStore().count(ns(req), scope(req, filterFromQuery(req.query, RESERVED))) });
}));

router.get('/:collection/:id', ah(async (req, res) => {
  const d = await getStore().findOne(ns(req), { id: req.params.id });
  if (!d) throw notFound('Document not found');
  res.json({ data: d });
}));

// Create one, or many when the body is an array
router.post('/:collection', ah(async (req, res) => {
  const many = Array.isArray(req.body);
  const raw = many ? req.body : [req.body];
  if (!raw.length) throw bad('Nothing to create');
  if (raw.length > MAX_BATCH) throw bad(`Max ${MAX_BATCH} documents per request`);
  const docs = raw.map((r) => newDoc(req, r));
  try {
    await getStore().insert(ns(req), docs);
  } catch (e) {
    if (e.code === 11000) throw bad('A document with that id already exists');
    throw e;
  }
  fire(req.client, 'document.created', { collection: req.params.collection, ids: docs.map((d) => d.id) });
  res.status(201).json(many ? { data: docs, created: docs.length } : { data: docs[0] });
}));

// Bulk update / delete by filter: { filter, set } / { filter }
router.patch('/:collection', ah(async (req, res) => {
  const { filter, set } = req.body || {};
  if (!filter || !Object.keys(filter).length) throw bad('filter is required for bulk update');
  const n = await getStore().updateMany(ns(req), scope(req, validateFilter(filter)), { ...body(set), updatedAt: now() });
  fire(req.client, 'document.bulk_updated', { collection: req.params.collection, count: n });
  res.json({ updated: n });
}));
router.delete('/:collection', ah(async (req, res) => {
  const filter = req.body?.filter;
  if (req.query.all === 'true') {
    const n = await getStore().delete(ns(req), scope(req, {}));
    return res.json({ deleted: n });
  }
  if (!filter || !Object.keys(filter).length) throw bad('Send { filter } in the body, or ?all=true to empty the collection');
  const n = await getStore().delete(ns(req), scope(req, validateFilter(filter)));
  fire(req.client, 'document.bulk_deleted', { collection: req.params.collection, count: n });
  res.json({ deleted: n });
}));

// Update: PATCH merges fields (null removes a field), PUT replaces the document
async function update(req, res, replace) {
  const store = getStore();
  const id = req.params.id;
  const existing = await store.findOne(ns(req), { id });
  if (!existing) throw notFound('Document not found');
  if (existing.ownerId && req.query.mine === 'true' && existing.ownerId !== req.user?.id) throw notFound('Document not found');
  const b = body(req.body);
  const unset = replace ? [] : Object.keys(b).filter((k) => b[k] === null);
  for (const k of unset) delete b[k];
  const patch = { ...b, updatedAt: now(), ...(replace && existing.ownerId ? { ownerId: existing.ownerId } : {}) };
  const d = await store.update(ns(req), { id }, patch, { replace, unset });
  fire(req.client, 'document.updated', { collection: req.params.collection, id });
  res.json({ data: d });
}
router.patch('/:collection/:id', ah((req, res) => update(req, res, false)));
router.put('/:collection/:id', ah((req, res) => update(req, res, true)));

router.delete('/:collection/:id', ah(async (req, res) => {
  const filter = scope(req, { id: req.params.id });
  const n = await getStore().delete(ns(req), filter);
  if (!n) throw notFound('Document not found');
  fire(req.client, 'document.deleted', { collection: req.params.collection, id: req.params.id });
  res.json({ deleted: true, id: req.params.id });
}));

module.exports = router;
