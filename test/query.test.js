const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toMongo, validateFilter, matches } = require('../src/lib/query');

test('filters translate to MongoDB and escape regex input', () => {
  const f = validateFilter({ n: { $gte: 5 }, name: { $contains: 'a.b(' }, $or: [{ k: 1 }, { t: { $startsWith: 'x' } }], tag: 'a' });
  assert.deepEqual(toMongo(f), {
    n: { $gte: 5 },
    name: { $regex: 'a\\.b\\(', $options: 'i' },
    $or: [{ k: 1 }, { t: { $regex: '^x', $options: 'i' } }],
    tag: 'a',
  });
});

test('JSON store matcher agrees on the same filter', () => {
  const f = validateFilter({ n: { $gte: 5 }, name: { $contains: 'AB' } });
  assert.equal(matches({ n: 6, name: 'xabx' }, f), true);
  assert.equal(matches({ n: 4, name: 'xabx' }, f), false);
});
