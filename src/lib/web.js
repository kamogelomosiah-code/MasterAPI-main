// Safe web access for the API and the agent: fetch a page and turn it into readable text.
// Protection against making this server reach private networks (SSRF):
//   * only http(s) on ports 80/443/8080/8443, no credentials in the URL
//   * the address is checked at connection time (so DNS tricks cannot bypass it), on every redirect hop
const http = require('http');
const https = require('https');
const net = require('net');
const dns = require('dns');
const zlib = require('zlib');
const { ApiError, bad } = require('./errors');

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const allowPrivate = () => process.env.WEB_ALLOW_PRIVATE === '1'; // for local testing only

function privateAddress(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('fc') || v.startsWith('fd')) return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    return m ? privateAddress(m[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { throw bad('That is not a valid URL'); }
  if (!/^https?:$/.test(u.protocol)) throw bad('Only http and https URLs are allowed');
  if (u.username || u.password) throw bad('URLs with a username or password are not allowed');
  if (!allowPrivate()) {
    if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) throw bad('That port is not allowed');
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && privateAddress(u.hostname.replace(/^\[|\]$/g, ''))) throw bad('That address is not allowed');
    if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) throw bad('That address is not allowed');
  }
  return u;
}

function guardedLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: false }, (err, address, family) => {
    if (err) return cb(err);
    if (!allowPrivate() && privateAddress(address)) return cb(new Error('That address is not allowed'));
    cb(null, address, family);
  });
}

function once(u, { method, headers, body, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method, headers, lookup: guardedLookup, timeout: timeoutMs }, (res) => {
      let stream = res;
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      const chunks = [];
      let n = 0, truncated = false;
      stream.on('data', (c) => {
        n += c.length;
        if (n > maxBytes) { truncated = true; res.destroy(); stream.destroy?.(); return; }
        chunks.push(c);
      });
      const done = () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks), truncated });
      stream.on('end', done);
      stream.on('close', done);
      stream.on('error', (e) => (truncated ? done() : reject(e)));
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Fetches a URL, following up to 4 redirects safely. Returns { status, url, type, buf, truncated }. */
async function fetchUrl(raw, { method = 'GET', headers = {}, body, timeoutMs = 12000, maxBytes = MAX_BYTES } = {}) {
  let u = checkUrl(raw);
  let m = method;
  let b = body;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let r;
    try {
      r = await once(u, { method: m, headers: { 'user-agent': 'MasterAPI-WebReader/1.0', accept: 'text/html,application/json,application/pdf,text/plain;q=0.9,*/*;q=0.5', 'accept-encoding': 'gzip, deflate, br', ...headers, ...(b ? { 'content-length': Buffer.byteLength(b) } : {}) }, body: b, timeoutMs, maxBytes });
    } catch (e) {
      if (e.code === 'ETIMEDOUT' || /timeout/i.test(e.message)) throw new ApiError(504, 'The website took too long to answer');
      if (/not allowed/.test(e.message)) throw bad('That address is not allowed');
      throw new ApiError(502, `Could not reach the website (${e.code || e.message})`);
    }
    if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.location) {
      u = checkUrl(new URL(r.headers.location, u).toString());
      if (r.status === 303 || ((r.status === 301 || r.status === 302) && m === 'POST')) { m = 'GET'; b = undefined; }
      continue;
    }
    return { status: r.status, url: u.toString(), type: String(r.headers['content-type'] || '').split(';')[0].trim().toLowerCase(), buf: r.buf, truncated: r.truncated, headers: r.headers };
  }
  throw new ApiError(502, 'The website redirected too many times');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', copy: '(c)' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const c = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ''; }
  return ENTITIES[e.toLowerCase()] ?? m;
});

/** HTML -> { title, description, text, links[] } */
function readableHtml(html, baseUrl) {
  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').replace(/\s+/g, ' ').trim());
  const description = decode(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] || /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i.exec(html)?.[1] || '');
  const links = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (links.length >= 40) break;
    try {
      const href = new URL(decode(m[1]), baseUrl).toString();
      if (!/^https?:/.test(href) || seen.has(href)) continue;
      seen.add(href);
      links.push({ text: decode(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 100), url: href });
    } catch { /* skip bad links */ }
  }
  let body = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg|template|iframe|head)[\s\S]*?<\/\1>/gi, ' ');
  body = body.replace(/<\/?(p|div|section|article|header|footer|main|nav|aside|ul|ol|table|tr|h[1-6]|br|blockquote|pre|form|figure)[^>]*>/gi, '\n').replace(/<li[^>]*>/gi, '\n- ').replace(/<\/t[dh]>/gi, ' | ');
  const text = decode(body.replace(/<[^>]+>/g, '')).replace(/[ \t\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, description, text, links };
}

/** Fetches a URL and returns readable text, whatever it is (web page, JSON, text, PDF, Word). */
async function readPage(url, opts) {
  const r = await fetchUrl(url, opts);
  const out = { url: r.url, status: r.status, type: r.type || 'unknown', truncated: r.truncated, title: '', description: '', text: '', links: [] };
  if (r.status >= 400) return { ...out, error: `The website answered ${r.status}` };
  const body = r.buf;
  if (/html|xml/.test(r.type) || (!r.type && /^\s*</.test(body.slice(0, 200).toString()))) Object.assign(out, readableHtml(body.toString('utf8'), r.url));
  else if (/json/.test(r.type)) { try { out.text = JSON.stringify(JSON.parse(body.toString('utf8')), null, 2); } catch { out.text = body.toString('utf8'); } }
  else if (r.type.startsWith('text/')) out.text = body.toString('utf8');
  else if (/pdf|officedocument\.wordprocessingml/.test(r.type) || /\.(pdf|docx)(\?|$)/i.test(r.url)) {
    const { parseDocument } = require('./docs');
    const d = await parseDocument(body, r.url.split('?')[0].split('/').pop());
    out.text = d.text; out.title = d.filename; if (d.pages) out.pages = d.pages;
  } else out.error = `This kind of content (${r.type}) cannot be read as text`;
  return out;
}
module.exports = { fetchUrl, readPage, readableHtml, checkUrl, privateAddress };
