// Shared test setup: a throwaway store, a running server and a tiny HTTP client.
const os = require('os'), path = require('path'), fs = require('fs'), http = require('http');

function setupEnv(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'masterapi-'));
  Object.assign(process.env, {
    DATA_FILE: path.join(dir, 'store.json'), MASTER_KEY: 'test-master-key-123456', TOKEN_SECRET: 'test-token-secret-123456',
    MONGODB_URI: '', RATE_LIMIT_PER_MINUTE: '1000', MONGODB_DB: `t_${Date.now()}`, ...extra,
  });
  return dir;
}

/** A small HTTP server whose behaviour is decided by `handler(req, bodyText, res)`. */
function mockServer(handler) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => handler(req, b, res));
    }).listen(0, '127.0.0.1', () => resolve({ server: s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}

function client(getBase) {
  return async (method, url, { body, key, admin, headers = {} } = {}) => {
    const h = { 'content-type': 'application/json', ...headers };
    if (key) h['x-api-key'] = key;
    if (admin) h.authorization = `Bearer ${process.env.MASTER_KEY}`;
    const r = await fetch(getBase() + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
  };
}
module.exports = { setupEnv, mockServer, client };

/** A real, minimal one-page PDF whose text is `lines` (use [] for a blank page). */
function makePdf(lines) {
  const text = lines.map((l, i) => `${i ? '0 -16 Td ' : ''}(${l.replace(/[()\\]/g, '\\$&')}) Tj`).join(' ');
  const stream = lines.length ? `BT /F1 12 Tf 72 720 Td ${text} ET` : '';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** A real minimal Word (.docx) file with one paragraph per line. */
async function makeDocx(lines) {
  const JSZip = require('jszip');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map((l) => `<w:p><w:r><w:t>${esc(l)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Sends raw bytes (a file) as the request body. */
function rawClient(getBase) {
  return async (url, { body, key, type = 'application/octet-stream', headers = {}, method = 'POST' }) => {
    const r = await fetch(getBase() + url, { method, headers: { 'content-type': type, 'x-api-key': key, ...headers }, body });
    return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
  };
}
module.exports.makePdf = makePdf;
module.exports.makeDocx = makeDocx;
module.exports.rawClient = rawClient;
