// Document services: parsing PDF / Word / text, and AI extraction into structured data.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { setupEnv, mockServer, client, makePdf, makeDocx, rawClient } = require('./helpers');

let hf, server, base, dir, key;
const hfCalls = [];
const call = client(() => base);
const send = rawClient(() => base);

before(async () => {
  hf = await mockServer((req, b, res) => {
    const j = JSON.parse(b || '{}');
    const sys = j.messages[0].content, user = j.messages[j.messages.length - 1].content;
    hfCalls.push({ sys, user, model: j.model });
    const reply = (content) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content } }] })); };
    if (user.includes('FAILALL')) { res.writeHead(500); return res.end('{}'); }
    if (user.includes('FLAKY') && !sys.includes('last answer was not valid JSON')) return reply('Sure! Here is what I found, but I forgot the JSON.');
    if (sys.includes('"experience"')) {
      return reply('```json\n' + JSON.stringify({ name: '  Kamogelo Mosia ', email: 'k@example.com', phone: '+27 67 742 6447', headline: 'Engineer', skills: ['TypeScript ', 'React', '', 5],
        experience: [{ title: 'Developer', company: 'Acme', start: '2022', end: 'Present', bullets: ['Built things', ''] }, { title: '', company: '' }],
        education: [{ school: 'UJ', qualification: 'BSc IT' }], links: [{ label: 'GitHub', url: 'https://github.com/x' }, { label: 'bad', url: 'javascript:alert(1)' }], languages: ['English'] }) + '\n```');
    }
    if (sys.includes('"transactions"')) {
      const tx = [];
      for (const line of user.split('\n')) { const m = line.match(/^(\d{2}\/\d{2}\/\d{4}) (.+?) (-?[\d,]+\.\d{2})$/); if (m) tx.push({ date: m[1], description: m[2], amount: m[3], category: m[2].includes('SPAR') ? 'Food' : '' }); }
      return reply(JSON.stringify({ currency: 'ZAR', openingBalance: '1 000.00', closingBalance: '2,500.50', transactions: tx }));
    }
    if (sys.includes('"merchant"')) return reply(JSON.stringify({ merchant: 'Checkers', date: '2026-11-02', total: 'R 245.50', items: [{ name: 'Milk', quantity: 2, price: '18.99' }] }));
    const fields = [...sys.matchAll(/"([^"]+)": "string"/g)].map((m) => m[1]);
    return reply(JSON.stringify(Object.fromEntries(fields.map((f) => [f, `value of ${f}`]))));
  });
  dir = setupEnv({ HF_TOKEN: 'hf-test-token', HF_API_URL: hf.url + '/v1/chat/completions', HF_MODEL: '', HF_TIMEOUT_MS: '3000', DOCS_PER_MINUTE: '30', AI_PER_MINUTE: '500' });
  await require('../src/lib/store').initStore();
  server = require('../src/app').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  key = (await call('POST', '/api/admin/apps', { admin: true, body: { name: 'Docs' } })).body.apiKey;
});
after(async () => { server.close(); hf.server.close(); await require('../src/lib/store').getStore().close(); fs.rmSync(dir, { recursive: true, force: true }); });

const RESUME = ['Kamogelo Mosia', 'kamo@example.com  +27 67 742 6447', 'Software Engineer', 'SKILLS', 'TypeScript, React, Node.js'];

test('status lists what can be parsed and extracted', async () => {
  const s = (await call('GET', '/api/v1/docs/status', { key })).body;
  assert.deepEqual(s.parse, ['pdf', 'docx', 'text']);
  assert.deepEqual(s.extract.map((x) => x.name), ['resume', 'statement', 'receipt']);
  assert.equal(s.ai, true);
  assert.equal((await call('GET', '/api/v1/docs/status')).status, 401, 'needs an app key');
});

test('parse: a real PDF (the type comes from the file, not the headers)', async () => {
  const r = await send('/api/v1/docs/parse', { key, body: makePdf(RESUME), type: 'text/plain', headers: { 'x-filename': 'cv.pdf' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.type, 'pdf');
  assert.equal(r.body.pages, 1);
  assert.equal(r.body.filename, 'cv.pdf');
  assert.match(r.body.text, /Kamogelo Mosia/);
  assert.match(r.body.text, /TypeScript, React, Node\.js/);
  assert.equal(r.body.truncated, false);
});

test('parse: a real Word document', async () => {
  const r = await send('/api/v1/docs/parse', { key, body: await makeDocx(['Jane Doe', 'Skills & tools <3', 'Cape Town']), type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  assert.equal(r.status, 200);
  assert.equal(r.body.type, 'docx');
  assert.deepEqual(r.body.text.split('\n').filter(Boolean), ['Jane Doe', 'Skills & tools <3', 'Cape Town']);
});

test('parse: plain text, JSON text, and JSON base64', async () => {
  assert.equal((await send('/api/v1/docs/parse', { key, body: 'hello\r\nworld', type: 'text/plain' })).body.text, 'hello\nworld');
  const j = await call('POST', '/api/v1/docs/parse', { key, body: { text: 'from json' } });
  assert.equal(j.body.text, 'from json');
  const b = await call('POST', '/api/v1/docs/parse', { key, body: { filename: 'x.pdf', contentBase64: makePdf(['base64 works']).toString('base64') } });
  assert.equal(b.body.type, 'pdf'); assert.match(b.body.text, /base64 works/);
});

test('parse: clear errors for bad files', async () => {
  const bad = async (body, type) => send('/api/v1/docs/parse', { key, body, type });
  assert.equal((await call('POST', '/api/v1/docs/parse', { key, body: {} })).status, 400, 'nothing sent');
  assert.equal((await bad(Buffer.from([0, 1, 2, 3, 0, 0, 9]), 'application/octet-stream')).status, 415, 'unknown binary');
  const JSZip = require('jszip'); const z = new JSZip(); z.file('a.txt', 'x');
  const notDocx = await bad(await z.generateAsync({ type: 'nodebuffer' }), 'application/zip');
  assert.equal(notDocx.status, 415); assert.match(notDocx.body.error, /not a Word/);
  const brokenPdf = await bad(Buffer.from('%PDF-1.4\nthis is not really a pdf'), 'application/pdf');
  assert.equal(brokenPdf.status, 422); assert.match(brokenPdf.body.error, /could not be read/);
  assert.equal((await bad(Buffer.alloc(10.5 * 1024 * 1024, 65), 'text/plain')).status, 413, 'over 10 MB');
});

test('parse: a PDF with no text says so', async () => {
  const r = await send('/api/v1/docs/parse', { key, body: makePdf([]), type: 'application/pdf' });
  assert.equal(r.status, 200); assert.equal(r.body.chars, 0); assert.match(r.body.warnings.join(' '), /No text was found/);
  const e = await send('/api/v1/docs/extract?schema=resume', { key, body: makePdf([]), type: 'application/pdf' });
  assert.equal(e.status, 422);
});

test('extract: a resume PDF becomes clean structured data', async () => {
  hfCalls.length = 0;
  const r = await send('/api/v1/docs/extract?schema=resume', { key, body: makePdf(RESUME), type: 'application/pdf', headers: { 'x-filename': 'cv.pdf' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.method, 'ai');
  assert.ok(r.body.model);
  assert.equal(r.body.document.pages, 1); assert.ok(!('text' in r.body.document), 'the full text is not sent back');
  const d = r.body.data;
  assert.equal(d.name, 'Kamogelo Mosia', 'trimmed');
  assert.deepEqual(d.skills, ['TypeScript', 'React', '5'], 'empty entries dropped, numbers made text');
  assert.equal(d.experience.length, 1, 'an empty job is dropped');
  assert.deepEqual(d.experience[0].bullets, ['Built things']);
  assert.deepEqual(d.links, [{ label: 'GitHub', url: 'https://github.com/x' }], 'only real web links are kept');
  assert.ok(hfCalls[0].user.includes('Kamogelo Mosia') && hfCalls[0].sys.includes('"experience"'), 'the document text and the shape reached the AI');
});

test('extract: a receipt, and custom fields', async () => {
  const rc = await call('POST', '/api/v1/ai/extract', { key, body: { text: 'CHECKERS\nMilk 2 x 18.99\nTotal R 245.50', schema: 'receipt' } });
  assert.deepEqual([rc.body.data.merchant, rc.body.data.total, rc.body.data.date, rc.body.data.items[0].price], ['Checkers', 245.5, '2026-11-02', 18.99]);
  const cf = await call('POST', '/api/v1/ai/extract', { key, body: { text: 'Invoice 42 due 1 Dec', fields: ['invoice_number', 'due date'] } });
  assert.deepEqual(cf.body.data, { invoice_number: 'value of invoice_number', 'due date': 'value of due date' });
  const q = await send('/api/v1/docs/extract?fields=a,b', { key, body: 'some text', type: 'text/plain' });
  assert.deepEqual(Object.keys(q.body.data), ['a', 'b']);
});

test('extract: if the AI forgets the JSON, it is asked once more', async () => {
  hfCalls.length = 0;
  const r = await call('POST', '/api/v1/ai/extract', { key, body: { text: 'FLAKY Jane Doe jane@example.com', schema: 'resume' } });
  assert.equal(r.status, 200); assert.equal(r.body.method, 'ai'); assert.equal(hfCalls.length, 2);
});

test('extract: a long statement is read in pieces and joined without duplicates', async () => {
  const lines = ['Statement period 2026', 'Opening balance 1 000.00'];
  for (let i = 0; i < 400; i++) lines.push(`${String((i % 28) + 1).padStart(2, '0')}/03/2026 SPAR STORE ${i} -${(10 + i).toFixed(2)}`);
  lines.push('01/03/2026 SPAR STORE 0 -10.00'); // an exact repeat of the first line
  hfCalls.length = 0;
  const r = await send('/api/v1/docs/extract?schema=statement', { key, body: lines.join('\n'), type: 'text/plain' });
  assert.equal(r.status, 200); assert.equal(r.body.method, 'ai');
  assert.ok(hfCalls.length >= 2, `read in ${hfCalls.length} pieces`);
  const d = r.body.data;
  assert.equal(d.transactions.length, 400, 'all lines, repeat removed');
  assert.deepEqual(d.transactions[0], { date: '2026-03-01', description: 'SPAR STORE 0', amount: -10, category: 'Groceries' }, 'date and amount cleaned; "Food" is not a category so it is guessed');
  assert.equal(d.openingBalance, 1000); assert.equal(d.closingBalance, 2500.5); assert.equal(d.currency, 'ZAR');
});

test('extract: if the AI is down, simple rules still answer (and say so)', async () => {
  const r = await call('POST', '/api/v1/ai/extract', { key, body: { text: 'FAILALL\n05/03/2026 CHECKERS HYPER 123.45 4,000.00\n07 Mar 2026 UBER TRIP -88.00 3,912.00', schema: 'statement' } });
  assert.equal(r.status, 200); assert.equal(r.body.method, 'rules');
  assert.match(r.body.warnings.join(' '), /simple rules/);
  assert.deepEqual(r.body.data.transactions.map((t) => [t.date, t.description, t.amount, t.category]), [['2026-03-05', 'CHECKERS HYPER', 123.45, 'Groceries'], ['2026-03-07', 'UBER TRIP', -88, 'Transport']]);
});

test('extract: input is checked', async () => {
  const bad = async (body, q = '') => (await call('POST', '/api/v1/ai/extract' + q, { key, body })).status;
  assert.equal(await bad({ text: 'x' }), 400, 'no schema');
  assert.equal(await bad({ text: 'x', schema: 'horoscope' }), 400, 'unknown schema');
  assert.equal(await bad({ text: '  ', schema: 'resume' }), 400, 'no text');
  assert.equal(await bad({ text: 'x', fields: [] }), 400);
  assert.equal(await bad({ text: 'x', fields: ['ok', 'bad"name'] }), 400);
  assert.equal(await bad({ text: 'x', fields: Array.from({ length: 31 }, (_, i) => 'f' + i) }), 400);
  assert.equal(await bad({ text: 'x'.repeat(200001), schema: 'resume' }), 400);
});

test('each app has its own document allowance', async () => {
  const other = (await call('POST', '/api/admin/apps', { admin: true, body: { name: 'Burst' } })).body.apiKey;
  // 30 per minute in this test run
  const codes = [];
  for (let i = 0; i < 32; i++) codes.push((await call('POST', '/api/v1/docs/parse', { key: other, body: { text: 'hi' } })).status);
  assert.equal(codes.filter((c) => c === 200).length, 30); assert.equal(codes[31], 429);
  assert.equal((await call('POST', '/api/v1/docs/parse', { key, body: { text: 'still fine' } })).status, 200, 'another app is unaffected');
});

test('extract and parse can read a stored file by id or path', async () => {
  const up = await fetch(`${base}/api/v1/files?path=in/cv.pdf`, { method: 'POST', headers: { 'x-api-key': key, 'content-type': 'application/pdf' }, body: makePdf(RESUME) });
  const id = (await up.json()).data.id;
  const a = await call('POST', '/api/v1/docs/parse', { key, body: { fileId: id } });
  assert.match(a.body.text, /Kamogelo Mosia/); assert.equal(a.body.filename, 'cv.pdf');
  const b = await call('POST', '/api/v1/docs/extract', { key, body: { path: 'in/cv.pdf', schema: 'resume' } });
  assert.equal(b.body.data.name, 'Kamogelo Mosia');
  assert.equal((await call('POST', '/api/v1/docs/parse', { key, body: { fileId: 'nope' } })).status, 404);
});
