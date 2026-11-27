// Document assistant: write, analyse, generate real Word / PowerPoint files, build with no AI.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const JSZip = require('jszip');
const { setupEnv, mockServer, client, makePdf } = require('./helpers');

let hf, server, base, dir, key, script;
const calls = [];
const call = client(() => base);
const enc = encodeURIComponent;

before(async () => {
  hf = await mockServer((req, b, res) => {
    const j = JSON.parse(b || '{}');
    const sys = j.messages[0].content, user = j.messages[j.messages.length - 1].content;
    calls.push({ sys, user, model: j.model });
    const content = script(sys, user, j.messages);
    if (content === null) { res.writeHead(500); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  dir = setupEnv({ HF_TOKEN: 'hf-test', HF_API_URL: hf.url + '/v1/chat/completions', HF_MODEL: '', HF_TIMEOUT_MS: '3000', WRITE_PER_MINUTE: '60', AI_PER_MINUTE: '500' });
  await require('../src/lib/store').initStore();
  server = require('../src/app').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  key = (await call('POST', '/api/admin/apps', { admin: true, body: { name: 'Assist' } })).body.apiKey;
});
after(async () => { server.close(); hf.server.close(); await require('../src/lib/store').getStore().close(); fs.rmSync(dir, { recursive: true, force: true }); });
const download = async (id) => Buffer.from(await (await fetch(`${base}/api/v1/files/${id}/content`, { headers: { 'x-api-key': key } })).arrayBuffer());

test('the default models are small open models, in order', async () => {
  const cfg = require('../src/config');
  assert.deepEqual(cfg.hfModels.slice(0, 3), ['Qwen/Qwen3-4B-Instruct-2507', 'Qwen/Qwen2.5-3B-Instruct', 'Qwen/Qwen2.5-7B-Instruct']);
  const t = (await call('GET', '/api/v1/ai/tasks', { key })).body;
  assert.ok(t.write.includes('cv-tailor') && t.write.includes('summarize'));
});

test('write: the task rule and the text reach the model; the reply comes back', async () => {
  script = (sys, user) => 'SUMMARY OF: ' + user.slice(user.indexOf('"""') + 4, user.indexOf('"""') + 34);
  const r = await call('POST', '/api/v1/ai/write', { key, body: { task: 'summarize', text: 'Quarterly revenue grew 12% to R4m.' } });
  assert.equal(r.status, 200); assert.match(r.body.text, /^SUMMARY OF: Quarterly revenue/); assert.equal(r.body.task, 'summarize');
  assert.match(calls.at(-1).sys, /Summarise the text/); assert.equal(calls.at(-1).model, 'Qwen/Qwen3-4B-Instruct-2507');
});

test('write: input is checked before the AI is used', async () => {
  const n = calls.length;
  const bad = async (body) => (await call('POST', '/api/v1/ai/write', { key, body })).status;
  assert.equal(await bad({ task: 'horoscope', text: 'x' }), 400);
  assert.equal(await bad({ task: 'summarize' }), 400, 'needs text');
  assert.equal(await bad({ task: 'translate', text: 'hi' }), 400, 'needs a language');
  assert.equal(await bad({ task: 'draft' }), 400, 'needs instructions');
  assert.equal(await bad({ task: 'summarize', text: 'x', model: 'evil/model' }), 400);
  assert.equal(await bad({ task: 'summarize', fileId: 'no-such-file' }), 404);
  assert.equal(calls.length, n, 'no AI calls were made');
});

test('write: reads a stored PDF by id or path, a Word file, and a web page', async () => {
  const pdf = makePdf(['Jane Doe', 'Senior analyst with ten years experience']);
  const up = await fetch(`${base}/api/v1/files?path=cv/jane.pdf`, { method: 'POST', headers: { 'x-api-key': key, 'content-type': 'application/pdf' }, body: pdf });
  const id = (await up.json()).data.id;
  script = (sys, user) => 'GOT: ' + user;
  const a = await call('POST', '/api/v1/ai/write', { key, body: { task: 'cv-review', fileId: id } });
  assert.match(a.body.text, /Senior analyst with ten years experience/);
  const b = await call('POST', '/api/v1/ai/write', { key, body: { task: 'cv-tailor', path: 'cv/jane.pdf', instructions: 'Job: data engineer' } });
  assert.match(b.body.text, /Jane Doe/); assert.match(b.body.text, /Job: data engineer/);
  assert.match(calls.at(-1).sys, /never invent jobs/);
  const docx = await require('./helpers').makeDocx(['Word text here']);
  await fetch(`${base}/api/v1/files?path=cv/w.docx`, { method: 'POST', headers: { 'x-api-key': key, 'content-type': 'application/octet-stream' }, body: docx });
  assert.match((await call('POST', '/api/v1/ai/write', { key, body: { task: 'summarize', path: 'cv/w.docx' } })).body.text, /Word text here/);
  const empty = await fetch(`${base}/api/v1/files?path=cv/blank.pdf`, { method: 'POST', headers: { 'x-api-key': key, 'content-type': 'application/pdf' }, body: makePdf([]) });
  assert.equal((await call('POST', '/api/v1/ai/write', { key, body: { task: 'summarize', path: 'cv/blank.pdf' } })).status, 422);
  assert.ok(empty.ok);
});

test('write: long text is cut with a warning', async () => {
  script = () => 'ok';
  const r = await call('POST', '/api/v1/ai/write', { key, body: { task: 'shorten', text: 'word '.repeat(5000) } });
  assert.match(r.body.warnings.join(' '), /first 12,000 characters/);
  assert.ok(calls.at(-1).user.length < 12300);
});

test('write: if every model fails the caller gets a clear 502', async () => {
  script = () => null;
  const r = await call('POST', '/api/v1/ai/write', { key, body: { task: 'summarize', text: 'x' } });
  assert.equal(r.status, 502);
});

test('analyze: structured result, cleaned', async () => {
  script = () => '```json\n' + JSON.stringify({ summary: ' Sales rose. ', keyPoints: ['Up 12%', 'Up 12%', '', 'New CEO'], topics: ['sales'], sentiment: 'excited', language: 'English',
    entities: { people: ['Ann'], organizations: ['Acme'], places: [], dates: ['Q3'], amounts: ['R4m', 5] }, actionItems: ['Send report'], answer: 'It rose 12%.' }) + '\n```';
  const r = await call('POST', '/api/v1/ai/analyze', { key, body: { text: 'Acme sales rose 12% in Q3.', question: 'How much did sales rise?' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.keyPoints, ['Up 12%', 'New CEO']);
  assert.equal(r.body.data.sentiment, 'neutral', 'unknown sentiment is neutral');
  assert.deepEqual(r.body.data.entities.amounts, ['R4m', '5']);
  assert.equal(r.body.data.answer, 'It rose 12%.'); assert.equal(r.body.data.summary, 'Sales rose.');
  const noq = await call('POST', '/api/v1/ai/analyze', { key, body: { text: 'Acme sales rose.' } });
  assert.equal(noq.body.data.answer, '', 'no question, no answer');
  assert.equal((await call('POST', '/api/v1/ai/analyze', { key, body: {} })).status, 400);
});

test('analyze: long content is summarised in parts first', async () => {
  const n = calls.length;
  script = (sys) => (sys.includes('Summarise this part') ? 'part summary' : JSON.stringify({ summary: 'whole', keyPoints: [], topics: [], sentiment: 'positive', language: 'English', entities: {}, actionItems: [], answer: '' }));
  const r = await call('POST', '/api/v1/ai/analyze', { key, body: { text: 'Line of text. '.repeat(3000) } });
  assert.equal(r.status, 200); assert.equal(r.body.data.summary, 'whole');
  assert.equal(calls.length - n, 5 + 1, '4-5 parts plus the analysis');
  assert.match(r.body.warnings.join(' '), /read in \d parts/);
  assert.match(calls.at(-1).user, /Part 1: part summary/);
});

test('analyze: retries once if the AI forgets the JSON', async () => {
  const n = calls.length;
  script = (sys) => (sys.includes('last answer was not valid JSON') ? JSON.stringify({ summary: 'second try' }) : 'Sure! Here you go.');
  const r = await call('POST', '/api/v1/ai/analyze', { key, body: { text: 'hello there' } });
  assert.equal(r.body.data.summary, 'second try'); assert.equal(calls.length - n, 2);
  script = () => 'never json';
  assert.equal((await call('POST', '/api/v1/ai/analyze', { key, body: { text: 'hello there' } })).status, 502);
});

test('generate: a real Word document is built and stored', async () => {
  script = () => '```json\n' + JSON.stringify({ title: 'Project Plan', subtitle: 'Draft', sections: [{ heading: 'Goals', paragraphs: ['Ship v1.'], bullets: ['Fast', 'Simple'] }, { heading: '', paragraphs: [], bullets: [] }] }) + '\n```';
  const r = await call('POST', '/api/v1/ai/generate', { key, body: { kind: 'document', prompt: 'A project plan for a small app' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.file.path, 'generated/project-plan.docx'); assert.equal(r.body.format, 'docx');
  assert.equal(r.body.structure.sections.length, 1, 'the empty section was dropped');
  const buf = await download(r.body.file.id);
  const { parseDocument } = require('../src/lib/docs');
  const parsed = await parseDocument(buf, 'x.docx');
  assert.match(parsed.text, /Project Plan/); assert.match(parsed.text, /Goals/); assert.match(parsed.text, /Ship v1\./); assert.match(parsed.text, /Simple/);
  const zip = await JSZip.loadAsync(buf);
  assert.ok(zip.file('word/document.xml') && zip.file('word/styles.xml') && zip.file('[Content_Types].xml'));
  const again = await call('POST', '/api/v1/ai/generate', { key, body: { kind: 'document', prompt: 'A project plan' } });
  assert.equal(again.body.file.path, 'generated/project-plan-2.docx', 'never overwrites by accident');
  assert.match(r.body.download, /\/api\/v1\/files\/.+\/content/);
});

test('generate: slides become a real .pptx with a title slide and one slide per item', async () => {
  script = (sys) => { assert.match(sys, /exactly 4 content slides/); return JSON.stringify({ title: 'Launch', subtitle: 'Q4', slides: [
    { title: 'Why', bullets: ['A & B', 'C < D'], notes: 'say hi' }, { title: 'How', bullets: ['x'] }, { title: 'When', bullets: ['soon'] }, { title: 'Ask', bullets: ['budget'] }] }); };
  const r = await call('POST', '/api/v1/ai/generate', { key, body: { kind: 'slides', prompt: 'Launch plan', slideCount: 4, save: { path: 'decks/launch.pptx' } } });
  assert.equal(r.status, 201); assert.equal(r.body.file.path, 'decks/launch.pptx');
  const zip = await JSZip.loadAsync(await download(r.body.file.id));
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  assert.equal(names.length, 5, 'title slide + 4');
  const s2 = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.match(s2, /Why/); assert.match(s2, /A &amp; B/); assert.match(s2, /C &lt; D/);
  assert.match(await zip.file('ppt/presentation.xml').async('string'), /sldId id="260"/);
  const again = await call('POST', '/api/v1/ai/generate', { key, body: { kind: 'slides', prompt: 'x', slideCount: 4, save: { path: 'decks/launch.pptx' } } });
  assert.equal(again.status, 409, 'an explicit path is not overwritten unless asked');
  const ow = await call('POST', '/api/v1/ai/generate', { key, body: { kind: 'slides', prompt: 'x', slideCount: 4, save: { path: 'decks/launch.pptx', overwrite: true } } });
  assert.equal(ow.body.file.version, 2);
});

test('generate: uses a stored file as source (e.g. turn a CV into a one-page summary)', async () => {
  script = (sys, user) => JSON.stringify({ title: 'Summary', sections: [{ heading: 'Source', paragraphs: [user.includes('Senior analyst') ? 'saw the CV' : 'missed it'] }] });
  const r = await call('POST', '/api/v1/ai/generate', { key, body: { kind: 'document', format: 'md', prompt: 'One-page summary', source: { path: 'cv/jane.pdf' } } });
  assert.equal(r.status, 201); assert.equal(r.body.file.type, 'text/markdown');
  assert.match((await download(r.body.file.id)).toString(), /saw the CV/);
});

test('generate: no file is stored when save is false, and bad requests are refused', async () => {
  script = () => JSON.stringify({ title: 'T', sections: [{ heading: 'H', paragraphs: ['p'] }] });
  const r = await call('POST', '/api/v1/ai/generate', { key, body: { kind: 'document', prompt: 'x', format: 'html', save: false } });
  assert.equal(r.status, 200); assert.match(Buffer.from(r.body.contentBase64, 'base64').toString(), /<h2>H<\/h2>/); assert.ok(!r.body.file);
  const bad = async (body) => (await call('POST', '/api/v1/ai/generate', { key, body })).status;
  assert.equal(await bad({ kind: 'poem', prompt: 'x' }), 400);
  assert.equal(await bad({ kind: 'document' }), 400);
  assert.equal(await bad({ kind: 'document', prompt: 'x', format: 'exe' }), 400);
  assert.equal(await bad({ kind: 'slides', prompt: 'x', format: 'docx' }), 400);
  assert.equal(await bad({ kind: 'document', prompt: 'x', save: { path: '../x.docx' } }), 400);
  script = () => JSON.stringify({ unrelated: true });
  assert.equal(await bad({ kind: 'slides', prompt: 'x' }), 502, 'unusable AI output');
});

test('build: documents and decks with no AI at all', async () => {
  const d = await call('POST', '/api/v1/docs/build', { key, body: { kind: 'document', format: 'md', document: { title: 'Notes', sections: [{ heading: 'A', bullets: ['one'] }] }, save: { path: 'b/notes.md' } } });
  assert.equal(d.status, 201); assert.equal((await download(d.body.file.id)).toString(), '# Notes\n\n## A\n\n- one\n');
  const s = await call('POST', '/api/v1/docs/build', { key, body: { kind: 'slides', slides: { title: 'D', slides: [{ title: 'One', bullets: ['a'] }] } } });
  assert.equal(s.status, 201); assert.equal(s.body.format, 'pptx');
  assert.equal((await call('POST', '/api/v1/docs/build', { key, body: { kind: 'document', document: {} } })).status, 400);
  assert.equal((await call('POST', '/api/v1/docs/build', { key, body: { kind: 'slides', slides: { slides: [] } } })).status, 400);
});

test('without a token the AI features say so, and /docs/build still works', async () => {
  const cfg = require('../src/config'); const t = cfg.hfToken; cfg.hfToken = '';
  try {
    assert.equal((await call('POST', '/api/v1/ai/write', { key, body: { task: 'summarize', text: 'x' } })).status, 503);
    assert.equal((await call('POST', '/api/v1/ai/generate', { key, body: { kind: 'document', prompt: 'x' } })).status, 503);
    assert.equal((await call('POST', '/api/v1/ai/analyze', { key, body: { text: 'x' } })).status, 503);
    assert.equal((await call('POST', '/api/v1/docs/build', { key, body: { kind: 'document', document: { title: 'T', sections: [{ paragraphs: ['p'] }] } } })).status, 201);
  } finally { cfg.hfToken = t; }
});
