// Where file bytes live. With MongoDB they go in a "_blobs" collection (so they survive Render restarts);
// without it they go in a folder next to the data file. File details live in the normal store.
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getStore } = require('./store');

const ID = /^[0-9a-f-]{36}$/;
const dir = (appId) => path.join(path.dirname(config.dataFile), 'blobs', String(appId).replace(/[^A-Za-z0-9_-]/g, '_'));
const mongo = () => getStore().kind === 'mongodb';
const coll = () => {
  const c = getStore().db.collection('_blobs');
  if (!getStore()._blobIdx) { getStore()._blobIdx = true; c.createIndex({ key: 1 }, { unique: true }).catch(() => {}); }
  return c;
};

async function put(appId, id, buf) {
  if (!ID.test(id)) throw new Error('bad id');
  if (mongo()) {
    await coll().updateOne({ key: `${appId}:${id}` }, { $set: { key: `${appId}:${id}`, appId, data: buf } }, { upsert: true });
    return;
  }
  fs.mkdirSync(dir(appId), { recursive: true });
  const f = path.join(dir(appId), id);
  fs.writeFileSync(f + '.tmp', buf);
  fs.renameSync(f + '.tmp', f);
}
async function get(appId, id) {
  if (!ID.test(id)) return null;
  if (mongo()) {
    const d = await coll().findOne({ key: `${appId}:${id}` });
    if (!d) return null;
    const bin = d.data;
    return Buffer.isBuffer(bin) ? bin : Buffer.from(bin.buffer.subarray(0, bin.position ?? bin.buffer.length));
  }
  try { return fs.readFileSync(path.join(dir(appId), id)); } catch { return null; }
}
async function del(appId, id) {
  if (!ID.test(id)) return;
  if (mongo()) { await coll().deleteOne({ key: `${appId}:${id}` }); return; }
  try { fs.unlinkSync(path.join(dir(appId), id)); } catch { /* already gone */ }
}
module.exports = { put, get, del };
