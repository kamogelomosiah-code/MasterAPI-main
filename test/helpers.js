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
