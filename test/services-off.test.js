// With no AI token and no email key the services say so clearly, and nothing breaks.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { setupEnv, client } = require('./helpers');

let server, base, dir, key;
const call = client(() => base);

before(async () => {
  dir = setupEnv({ HF_TOKEN: '', RESEND_API_KEY: '', MAIL_TO: '' });
  await require('../src/lib/store').initStore();
  server = require('../src/app').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  key = (await call('POST', '/api/admin/apps', { admin: true, body: { name: 'Off' } })).body.apiKey;
});
after(async () => { server.close(); await require('../src/lib/store').getStore().close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('health says AI and mail are off', async () => {
  const h = (await call('GET', '/api/health')).body;
  assert.equal(h.services.ai.configured, false);
  assert.equal(h.services.mail.configured, false);
});
test('chat answers 503 with a clear message', async () => {
  const r = await call('POST', '/api/v1/ai/chat', { key, body: { prompt: 'hi' } });
  assert.equal(r.status, 503);
  assert.match(r.body.error, /HF_TOKEN/);
});
test('contact is still saved, and the reply says email is off', async () => {
  const r = await call('POST', '/api/v1/mail/contact', { key, body: { name: 'A', email: 'a@b.co', message: 'hi' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.saved, true);
  assert.equal(r.body.emailed, false);
  assert.match(r.body.note, /RESEND_API_KEY/);
});
