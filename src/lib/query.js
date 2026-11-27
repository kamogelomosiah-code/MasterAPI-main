// A small, safe query language shared by the MongoDB and JSON stores.
// Filters look like MongoDB: { age: { $gte: 18 }, status: 'active', name: { $contains: 'ann' } }
// Only the operators below are allowed, so callers can't run server-side code ($where etc.).
const { bad } = require('./errors');

const OPS = ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$exists', '$contains', '$startsWith'];
const FIELD = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;

function validateFilter(filter, depth = 0) {
  if (filter == null) return {};
  if (typeof filter !== 'object' || Array.isArray(filter)) throw bad('Filter must be an object');
  if (depth > 3) throw bad('Filter is nested too deeply');
  const out = {};
  for (const [k, v] of Object.entries(filter)) {
    if (k === '$or' || k === '$and') {
      if (!Array.isArray(v) || v.length > 20) throw bad(`${k} must be an array (max 20)`);
      out[k] = v.map((f) => validateFilter(f, depth + 1));
      continue;
    }
    if (!FIELD.test(k)) throw bad(`Invalid field name: ${k}`);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const cond = {};
      for (const [op, val] of Object.entries(v)) {
        if (!OPS.includes(op)) throw bad(`Unsupported operator: ${op}. Allowed: ${OPS.join(', ')}`);
        if ((op === '$in' || op === '$nin') && !Array.isArray(val)) throw bad(`${op} needs an array`);
        if ((op === '$contains' || op === '$startsWith') && typeof val !== 'string') throw bad(`${op} needs a string`);
        cond[op] = val;
      }
      out[k] = cond;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Builds a filter from ?where={json} plus simple ?field=value query params. */
function filterFromQuery(q, reserved) {
  let filter = {};
  if (q.where) {
    try {
      filter = JSON.parse(q.where);
    } catch {
      throw bad('where must be valid JSON');
    }
  }
  for (const [k, v] of Object.entries(q)) {
    if (reserved.includes(k) || k === 'where') continue;
    filter[k] = coerce(v);
  }
  return validateFilter(filter);
}

function coerce(v) {
  if (Array.isArray(v)) return { $in: v.map(coerce) };
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (v !== '' && !isNaN(Number(v)) && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

const get = (doc, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Evaluates a validated filter against a plain object (used by the JSON store). */
function matches(doc, filter) {
  for (const [k, cond] of Object.entries(filter)) {
    if (k === '$or') { if (!cond.some((f) => matches(doc, f))) return false; continue; }
    if (k === '$and') { if (!cond.every((f) => matches(doc, f))) return false; continue; }
    const val = get(doc, k);
    if (!cond || typeof cond !== 'object' || Array.isArray(cond)) {
      if (Array.isArray(val) ? !val.includes(cond) : val !== cond) return false;
      continue;
    }
    for (const [op, x] of Object.entries(cond)) {
      const ok = {
        $eq: () => val === x,
        $ne: () => val !== x,
        $gt: () => val != null && val > x,
        $gte: () => val != null && val >= x,
        $lt: () => val != null && val < x,
        $lte: () => val != null && val <= x,
        $in: () => (Array.isArray(val) ? val.some((v) => x.includes(v)) : x.includes(val)),
        $nin: () => !(Array.isArray(val) ? val.some((v) => x.includes(v)) : x.includes(val)),
        $exists: () => (val !== undefined) === Boolean(x),
        $contains: () => typeof val === 'string' && val.toLowerCase().includes(x.toLowerCase()),
        $startsWith: () => typeof val === 'string' && val.toLowerCase().startsWith(x.toLowerCase()),
      }[op]();
      if (!ok) return false;
    }
  }
  return true;
}

/** Converts a validated filter to a real MongoDB filter. */
function toMongo(filter) {
  const out = {};
  for (const [k, cond] of Object.entries(filter)) {
    if (k === '$or' || k === '$and') { out[k] = cond.map(toMongo); continue; }
    if (!cond || typeof cond !== 'object' || Array.isArray(cond)) { out[k] = cond; continue; }
    const m = {};
    for (const [op, x] of Object.entries(cond)) {
      if (op === '$contains') m.$regex = esc(x), (m.$options = 'i');
      else if (op === '$startsWith') m.$regex = '^' + esc(x), (m.$options = 'i');
      else m[op] = x;
    }
    out[k] = m;
  }
  return out;
}

function parseSort(sort) {
  if (!sort) return [['createdAt', -1]];
  return String(sort).split(',').slice(0, 3).map((s) => {
    const desc = s.startsWith('-');
    const f = desc ? s.slice(1) : s;
    if (!FIELD.test(f)) throw bad(`Invalid sort field: ${f}`);
    return [f, desc ? -1 : 1];
  });
}

function compare(sort) {
  return (a, b) => {
    for (const [f, dir] of sort) {
      const x = get(a, f), y = get(b, f);
      if (x === y) continue;
      if (x === undefined || x === null) return 1;
      if (y === undefined || y === null) return -1;
      return (x > y ? 1 : -1) * dir;
    }
    return 0;
  };
}

module.exports = { validateFilter, filterFromQuery, matches, toMongo, parseSort, compare, FIELD };
