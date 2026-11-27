// Document services with no AI configured: parsing works fully, extraction uses simple rules and says so.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { setupEnv, client, makePdf } = require('./helpers');
let server, base, dir, key;
const call = client(() => base);
before(async () => {
  dir = setupEnv({ HF_TOKEN: '' });
  await require('../src/lib/store').initStore();
  server = require('../src/app').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  key = (await call('POST', '/api/admin/apps', { admin: true, body: { name: 'Off' } })).body.apiKey;
});
after(async () => { server.close(); await require('../src/lib/store').getStore().close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('parsing still works', async () => {
  const r = await call('POST', '/api/v1/docs/parse', { key, body: { filename: 'a.pdf', contentBase64: makePdf(['Works without AI']).toString('base64') } });
  assert.equal(r.status, 200); assert.match(r.body.text, /Works without AI/);
});
test('a resume: contact details, links and skills found by rules', async () => {
  const text = 'Jane Doe\njane@example.com | +27 82 555 1234\nhttps://github.com/jane\nSKILLS\nPython, SQL, Docker\nEXPERIENCE\nDev at Acme';
  const r = await call('POST', '/api/v1/ai/extract', { key, body: { text, schema: 'resume' } });
  assert.equal(r.status, 200); assert.equal(r.body.method, 'rules'); assert.match(r.body.warnings.join(' '), /not configured/);
  assert.equal(r.body.data.name, 'Jane Doe'); assert.equal(r.body.data.email, 'jane@example.com'); assert.match(r.body.data.phone, /82 555 1234/);
  assert.deepEqual(r.body.data.links.map((l) => l.url), ['https://github.com/jane']);
  assert.deepEqual(r.body.data.skills, ['Python', 'SQL', 'Docker']);
});
test('a statement: transactions found by rules', async () => {
  const r = await call('POST', '/api/v1/ai/extract', { key, body: { text: '2026\n02/03/2026 WOOLWORTHS 310.20 9,000.00\nnot a transaction', schema: 'statement' } });
  assert.equal(r.body.method, 'rules'); assert.equal(r.body.data.transactions.length, 1); assert.equal(r.body.data.transactions[0].category, 'Groceries');
});
test('custom fields come back empty rather than invented', async () => {
  const r = await call('POST', '/api/v1/ai/extract', { key, body: { text: 'Invoice 42', fields: ['invoice_number'] } });
  assert.deepEqual(r.body.data, { invoice_number: '' });
});
