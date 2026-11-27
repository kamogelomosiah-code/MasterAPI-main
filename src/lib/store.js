// Storage layer. Uses MongoDB when MONGODB_URI is set, otherwise a JSON file on disk
// (fine for development and small apps). Both behave the same way.
//
// Data lives in "namespaces" (one per app + collection). Every document has a string `id`,
// `createdAt` and `updatedAt`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { matches, toMongo, compare } = require('./query');

const newId = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const clean = (d) => {
  if (!d) return d;
  const { _id, ...rest } = d;
  return rest;
};

class JsonStore {
  constructor(file) {
    this.kind = 'json';
    this.file = file;
    this.data = {};
    this.timer = null;
  }
  async init() {
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw new Error(`Could not read ${this.file}: ${e.message}`);
      this.data = {};
    }
  }
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 100);
  }
  flush() {
    clearTimeout(this.timer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
  col(ns) {
    return (this.data[ns] ||= []);
  }
  async insert(ns, docs) {
    const c = this.col(ns);
    for (const d of docs) if (c.some((x) => x.id === d.id)) throw Object.assign(new Error('Duplicate id'), { code: 11000 });
    c.push(...docs.map((d) => structuredClone(d)));
    this.save();
    return docs;
  }
  async find(ns, filter = {}, { sort = [['createdAt', -1]], skip = 0, limit = 50, fields } = {}) {
    let rows = (this.data[ns] || []).filter((d) => matches(d, filter));
    rows.sort(compare(sort));
    rows = rows.slice(skip, skip + limit);
    return rows.map((d) => project(structuredClone(d), fields));
  }
  async count(ns, filter = {}) {
    return (this.data[ns] || []).filter((d) => matches(d, filter)).length;
  }
  async findOne(ns, filter) {
    const d = (this.data[ns] || []).find((x) => matches(x, filter));
    return d ? structuredClone(d) : null;
  }
  async update(ns, filter, patch, { replace = false, unset = [] } = {}) {
    const d = (this.data[ns] || []).find((x) => matches(x, filter));
    if (!d) return null;
    if (replace) for (const k of Object.keys(d)) if (!['id', 'createdAt'].includes(k)) delete d[k];
    Object.assign(d, structuredClone(patch));
    for (const k of unset) delete d[k];
    this.save();
    return structuredClone(d);
  }
  async updateMany(ns, filter, patch) {
    let n = 0;
    for (const d of this.data[ns] || []) if (matches(d, filter)) Object.assign(d, structuredClone(patch)), n++;
    if (n) this.save();
    return n;
  }
  async inc(ns, filter, field, by, defaults) {
    let d = (this.data[ns] || []).find((x) => matches(x, filter));
    if (!d) this.col(ns).push((d = { ...defaults, [field]: 0 }));
    d[field] = (d[field] || 0) + by;
    this.save();
    return structuredClone(d);
  }
  async delete(ns, filter) {
    const c = this.data[ns] || [];
    const keep = c.filter((d) => !matches(d, filter));
    const n = c.length - keep.length;
    if (n) (this.data[ns] = keep), this.save();
    return n;
  }
  async namespaces(prefix) {
    return Object.keys(this.data).filter((k) => k.startsWith(prefix) && this.data[k].length);
  }
  async drop(ns) {
    const had = ns in this.data;
    delete this.data[ns];
    this.save();
    return had;
  }
  async ping() {
    return true;
  }
  async close() {
    this.flush();
  }
}

function project(d, fields) {
  if (!fields || !fields.length) return d;
  const out = { id: d.id };
  for (const f of fields) if (f in d) out[f] = d[f];
  return out;
}

class MongoStore {
  constructor(uri, dbName) {
    this.kind = 'mongodb';
    this.uri = uri;
    this.dbName = dbName;
  }
  async init() {
    const { MongoClient } = require('mongodb');
    this.client = new MongoClient(this.uri, { serverSelectionTimeoutMS: 10000 });
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    this.indexed = new Set();
  }
  name(ns) {
    return ns.replace(/:/g, '__');
  }
  col(ns) {
    const c = this.db.collection(this.name(ns));
    if (!this.indexed.has(ns)) {
      this.indexed.add(ns);
      c.createIndex({ id: 1 }, { unique: true }).catch(() => {});
      c.createIndex({ createdAt: -1 }).catch(() => {});
    }
    return c;
  }
  async insert(ns, docs) {
    if (!docs.length) return docs;
    await this.col(ns).insertMany(docs.map((d) => ({ ...d })), { ordered: true });
    return docs;
  }
  async find(ns, filter = {}, { sort = [['createdAt', -1]], skip = 0, limit = 50, fields } = {}) {
    const projection = fields && fields.length ? Object.fromEntries([['id', 1], ...fields.map((f) => [f, 1])]) : {};
    const rows = await this.col(ns).find(toMongo(filter), { projection: { _id: 0, ...projection } }).sort(sort).skip(skip).limit(limit).toArray();
    return rows;
  }
  async count(ns, filter = {}) {
    return this.col(ns).countDocuments(toMongo(filter));
  }
  async findOne(ns, filter) {
    return clean(await this.col(ns).findOne(toMongo(filter), { projection: { _id: 0 } }));
  }
  async update(ns, filter, patch, { replace = false, unset = [] } = {}) {
    const c = this.col(ns);
    const f = toMongo(filter);
    if (replace) {
      const cur = await c.findOne(f);
      if (!cur) return null;
      await c.replaceOne({ _id: cur._id }, { id: cur.id, createdAt: cur.createdAt, ...patch });
      return clean(await c.findOne({ _id: cur._id }, { projection: { _id: 0 } }));
    }
    const upd = { $set: patch };
    if (unset.length) upd.$unset = Object.fromEntries(unset.map((k) => [k, '']));
    return clean(await c.findOneAndUpdate(f, upd, { returnDocument: 'after', projection: { _id: 0 } }));
  }
  async updateMany(ns, filter, patch) {
    const r = await this.col(ns).updateMany(toMongo(filter), { $set: patch });
    return r.modifiedCount;
  }
  async inc(ns, filter, field, by, defaults) {
    const r = await this.col(ns).findOneAndUpdate(
      toMongo(filter),
      // The filter's fields are copied in on insert, so don't set them twice.
      { $inc: { [field]: by }, $setOnInsert: Object.fromEntries(Object.entries(defaults).filter(([k]) => !(k in filter) && k !== field)) },
      { upsert: true, returnDocument: 'after', projection: { _id: 0 } },
    );
    return clean(r);
  }
  async delete(ns, filter) {
    const r = await this.col(ns).deleteMany(toMongo(filter));
    return r.deletedCount;
  }
  async namespaces(prefix) {
    const p = this.name(prefix);
    const list = await this.db.listCollections({}, { nameOnly: true }).toArray();
    return list.map((c) => c.name).filter((n) => n.startsWith(p)).map((n) => n.replace(/__/g, ':'));
  }
  async drop(ns) {
    return this.col(ns).drop().then(() => true, () => false);
  }
  async ping() {
    await this.db.command({ ping: 1 });
    return true;
  }
  async close() {
    await this.client.close();
  }
}

let store;
async function initStore() {
  if (store) return store;
  if (config.mongoUri) {
    const s = new MongoStore(config.mongoUri, config.mongoDb);
    try {
      await s.init();
      console.log(`✅ Storage: MongoDB (${config.mongoDb})`);
      store = s;
      return store;
    } catch (e) {
      if (config.nodeEnv === 'production') throw new Error(`MongoDB connection failed: ${e.message}`);
      console.warn(`⚠️  MongoDB connection failed (${e.message}) — falling back to JSON file storage.`);
    }
  }
  store = new JsonStore(config.dataFile);
  await store.init();
  console.log(`✅ Storage: JSON file (${config.dataFile})`);
  return store;
}
const getStore = () => {
  if (!store) throw new Error('Store not initialised');
  return store;
};

module.exports = { initStore, getStore, newId, now, JsonStore };
