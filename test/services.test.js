// AI and mail services, tested against stand-ins for Hugging Face and the email provider.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { setupEnv, mockServer, client } = require('./helpers');

const hfCalls = [], mails = [];
let hf, resend, server, base, dir;
const call = client(() => base);
const newApp = async (extra = {}) => (await call('POST', '/api/admin/apps', { admin: true, body: { name: 'T' + Math.random().toString(36).slice(2, 6), ...extra } })).body;

before(async () => {
  // Hugging Face stand-in. The model name decides what happens.
  hf = await mockServer((req, b, res) => {
    const j = JSON.parse(b || '{}');
    hfCalls.push({ auth: req.headers.authorization, ...j });
    if (req.headers.authorization !== 'Bearer hf-test-token') { res.writeHead(401); return res.end('{}'); }
    if (j.messages.some((m) => m.content === 'DENY_TOKEN')) { res.writeHead(403); return res.end('{}'); }
    if (j.messages.some((m) => m.content === 'FAIL_ALL')) { res.writeHead(500); return res.end('{}'); }
    if (j.model === 'bad/model') { res.writeHead(404); return res.end('{"error":"not supported"}'); }
    if (j.model === 'slow/model') return; // never answers
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `reply from ${j.model}` } }], usage: { total_tokens: 7 } }));
  });
  // Email provider stand-in.
  resend = await mockServer((req, b, res) => {
    const j = JSON.parse(b || '{}'); mails.push({ auth: req.headers.authorization, ...j });
    if (req.headers.authorization !== 'Bearer re_test') { res.writeHead(401); return res.end('{}'); }
    if ((j.subject || '').includes('FAILMAIL')) { res.writeHead(500); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"mail_1"}');
  });
  dir = setupEnv({
    HF_TOKEN: 'hf-test-token', HF_API_URL: hf.url + '/v1/chat/completions', HF_MODEL: 'bad/model', HF_MODELS: 'slow/model',
    HF_TIMEOUT_MS: '600', AI_DEADLINE_MS: '4000', AI_PER_MINUTE: '5',
    RESEND_API_KEY: 're_test', RESEND_API_URL: resend.url + '/emails', MAIL_FROM: 'Site <noreply@example.test>', MAIL_TO: 'owner@example.test', MAIL_PER_HOUR: '4',
  });
  const { initStore } = require('../src/lib/store');
  await initStore();
  server = require('../src/app').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close(); hf.server.close(); resend.server.close();
  await require('../src/lib/store').getStore().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('health reports the services and honest storage status', async () => {
  const h = (await call('GET', '/api/health')).body;
  assert.equal(h.status, 'ok');
  assert.match(h.version, /^3\./);
  assert.equal(h.persistent, false, 'file storage is not persistent');
  assert.equal(h.services.ai.configured, true);
  assert.deepEqual(h.services.ai.models, ['bad/model', 'slow/model', 'Qwen/Qwen3-4B-Instruct-2507', 'Qwen/Qwen2.5-3B-Instruct', 'Qwen/Qwen2.5-7B-Instruct', 'meta-llama/Llama-3.2-3B-Instruct']);
  assert.equal(h.services.mail.configured, true);
  assert.ok(!JSON.stringify(h).includes('hf-test-token') && !JSON.stringify(h).includes('re_test'), 'no secrets in health');
});

test('chat: tries the next model when one is unsupported or too slow', async () => {
  const { apiKey } = await newApp();
  hfCalls.length = 0;
  const r = await call('POST', '/api/v1/ai/chat', { key: apiKey, body: { prompt: 'Hello' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.reply, 'reply from Qwen/Qwen3-4B-Instruct-2507');
  assert.equal(r.body.model, 'Qwen/Qwen3-4B-Instruct-2507');
  assert.deepEqual(hfCalls.map((c) => c.model), ['bad/model', 'slow/model', 'Qwen/Qwen3-4B-Instruct-2507'], 'tried in order and stopped at the first answer');
  assert.ok(r.body.ms >= 500, 'waited out the slow model');
});

test('chat: system prompt, history and the new question reach the model in order', async () => {
  const { apiKey } = await newApp();
  hfCalls.length = 0;
  await call('POST', '/api/v1/ai/chat', { key: apiKey, body: {
    model: 'Qwen/Qwen2.5-7B-Instruct', system: 'You are a test.',
    history: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello!' }, { role: 'user', content: '   ' }],
    prompt: 'And now?', maxTokens: 99999, temperature: 0.2 } });
  const c = hfCalls[0];
  assert.equal(c.model, 'Qwen/Qwen2.5-7B-Instruct', 'a requested model is tried first');
  assert.deepEqual(c.messages.map((m) => `${m.role}:${m.content}`), ['system:You are a test.', 'user:Hi', 'assistant:Hello!', 'user:And now?']);
  assert.equal(c.max_tokens, 1024, 'maxTokens is capped');
  assert.equal(c.temperature, 0.2);
});

test('chat: rejects bad input before using any AI', async () => {
  const { apiKey } = await newApp();
  hfCalls.length = 0;
  const bad = async (body) => (await call('POST', '/api/v1/ai/chat', { key: apiKey, body })).status;
  assert.equal(await bad({}), 400, 'nothing to say');
  assert.equal(await bad({ prompt: '   ' }), 400);
  assert.equal(await bad({ messages: [{ role: 'robot', content: 'x' }] }), 400, 'unknown role');
  assert.equal(await bad({ messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }] }), 400, 'last turn must be the user');
  assert.equal(await bad({ prompt: 'x'.repeat(6001) }), 400, 'too long');
  assert.equal(await bad({ prompt: 'x', model: 'some/unlisted-model' }), 400, 'unknown model');
  assert.equal(await bad({ prompt: 'x', temperature: 'hot' }), 400);
  assert.equal(await bad({ prompt: 'x', system: '' }), 400);
  assert.equal(hfCalls.length, 0, 'no request reached the model');
});

test('chat: stops at once when Hugging Face refuses the token', async () => {
  const { apiKey } = await newApp();
  hfCalls.length = 0;
  const r = await call('POST', '/api/v1/ai/chat', { key: apiKey, body: { prompt: 'DENY_TOKEN' } });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /refused the token/);
  assert.equal(hfCalls.length, 1, 'did not try other models with a refused token');
});

test('chat: a clear error when every model fails', async () => {
  const { apiKey } = await newApp();
  const r = await call('POST', '/api/v1/ai/chat', { key: apiKey, body: { prompt: 'FAIL_ALL' } });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /No AI model could answer/);
  assert.ok(Array.isArray(r.body.details.attempts) && r.body.details.attempts.length >= 2);
});

test('chat: each app has its own limit and gets Retry-After', async () => {
  const { apiKey } = await newApp();
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await call('POST', '/api/v1/ai/chat', { key: apiKey, body: { prompt: 'hi', model: 'Qwen/Qwen2.5-7B-Instruct' } })).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
  const other = await newApp();
  assert.equal((await call('POST', '/api/v1/ai/chat', { key: other.apiKey, body: { prompt: 'hi', model: 'Qwen/Qwen2.5-7B-Instruct' } })).status, 200, 'another app is unaffected');
  const r = await call('POST', '/api/v1/ai/chat', { key: apiKey, body: { prompt: 'hi' } });
  assert.equal(r.headers.get('retry-after'), '30');
});

test('chat: usage is counted per app', async () => {
  const a = await newApp();
  await call('POST', '/api/v1/ai/chat', { key: a.apiKey, body: { prompt: 'hi', model: 'Qwen/Qwen2.5-7B-Instruct' } });
  await new Promise((r) => setTimeout(r, 150));
  const info = (await call('GET', `/api/admin/apps/${a.data.id}`, { admin: true })).body.data;
  assert.equal(info.usage[0].aiChats, 1);
});

test('chat: needs an app key', async () => {
  assert.equal((await call('POST', '/api/v1/ai/chat', { body: { prompt: 'x' } })).status, 401);
  assert.equal((await call('GET', '/api/v1/ai/status')).status, 401);
});

test('mail: a contact message is saved and emailed, with visitor text escaped', async () => {
  const { apiKey, data } = await newApp({ name: 'My Portfolio' });
  mails.length = 0;
  const r = await call('POST', '/api/v1/mail/contact', { key: apiKey, body: { name: 'Jo <script>', email: 'jo@example.com', subject: 'Hi', message: 'Hello <b>there</b> & welcome' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.emailed, true);
  assert.equal(r.body.saved, true);
  const m = mails[0];
  assert.equal(m.auth, 'Bearer re_test');
  assert.deepEqual(m.to, ['owner@example.test']);
  assert.equal(m.reply_to, 'jo@example.com');
  assert.equal(m.from, 'Site <noreply@example.test>');
  assert.match(m.subject, /My Portfolio/);
  assert.ok(m.html.includes('Jo &lt;script&gt;') && m.html.includes('&lt;b&gt;there&lt;/b&gt; &amp; welcome'), 'html is escaped');
  assert.ok(!m.html.includes('<script>') && !m.html.includes('<b>there'), 'no raw visitor markup in the email');
  const saved = (await call('GET', '/api/v1/data/contact_messages', { key: apiKey })).body.data;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].emailed, true);
  assert.equal(saved[0].message, 'Hello <b>there</b> & welcome', 'stored exactly as written');
  assert.ok(data.id);
});

test('mail: an app can have its own contact address', async () => {
  const { apiKey, data } = await newApp();
  assert.equal((await call('PATCH', `/api/admin/apps/${data.id}`, { admin: true, body: { contactEmail: 'not-an-email' } })).status, 400);
  await call('PATCH', `/api/admin/apps/${data.id}`, { admin: true, body: { contactEmail: 'me@mine.test' } });
  mails.length = 0;
  await call('POST', '/api/v1/mail/contact', { key: apiKey, body: { name: 'A', email: 'a@b.co', message: 'hi' } });
  assert.deepEqual(mails[0].to, ['me@mine.test']);
});

test('mail: if the provider fails the message is still saved', async () => {
  const { apiKey } = await newApp();
  const r = await call('POST', '/api/v1/mail/contact', { key: apiKey, body: { name: 'A', email: 'a@b.co', subject: 'FAILMAIL', message: 'hi' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.emailed, false);
  assert.match(r.body.note, /saved/);
  const saved = (await call('GET', '/api/v1/data/contact_messages', { key: apiKey })).body.data;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].emailed, false);
});

test('mail: rejects bad input and saves nothing', async () => {
  const { apiKey } = await newApp();
  const bad = async (body) => (await call('POST', '/api/v1/mail/contact', { key: apiKey, body })).status;
  assert.equal(await bad({ email: 'a@b.co', message: 'hi' }), 400, 'name missing');
  assert.equal(await bad({ name: 'A', email: 'nope', message: 'hi' }), 400, 'bad email');
  assert.equal(await bad({ name: 'A', email: 'a@b.co', message: '  ' }), 400, 'empty message');
  assert.equal(await bad({ name: 'A', email: 'a@b.co', message: 'x'.repeat(5001) }), 400, 'too long');
  assert.equal(await bad({ name: 'x'.repeat(101), email: 'a@b.co', message: 'hi' }), 400, 'name too long');
  assert.equal((await call('GET', '/api/v1/data/contact_messages', { key: apiKey })).body.data.length, 0);
});

test('mail: each app has an hourly limit', async () => {
  const { apiKey } = await newApp();
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await call('POST', '/api/v1/mail/contact', { key: apiKey, body: { name: 'A', email: 'a@b.co', message: 'hi ' + i } })).status);
  assert.deepEqual(codes, [201, 201, 201, 201, 429]);
});
