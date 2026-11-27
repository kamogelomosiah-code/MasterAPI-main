// Builds the Express app (no listening here, so tests can use it directly).
const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const { requireApp } = require('./lib/middleware');
const { ApiError } = require('./lib/errors');
const { getStore } = require('./lib/store');
const apps = require('./lib/apps');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    next();
  });
  app.use(cors({
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Master-Key', 'X-App-Id'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
  }));
  app.use(express.json({ limit: '5mb' }));

  // Public
  app.get('/api/health', async (req, res) => {
    try {
      await getStore().ping();
      res.json({ status: 'ok', storage: getStore().kind, uptime: Math.round(process.uptime()), time: new Date().toISOString() });
    } catch (e) {
      res.status(503).json({ status: 'error', storage: getStore().kind, error: 'Database unreachable' });
    }
  });
  app.get('/api', (req, res) => res.json(require('./docs')));
  app.get('/api/docs', (req, res) => res.json(require('./docs')));

  // Admin
  app.use('/api/admin', require('./routes/admin'));

  // App (API key) routes — versioned under /api/v1
  const v1 = express.Router();
  v1.use(requireApp);
  v1.get('/me', (req, res) => res.json({ data: apps.view(req.client) }));
  v1.use('/data', require('./routes/data'));
  v1.use('/auth', require('./routes/users'));
  v1.use('/', require('./routes/services'));
  app.use('/api/v1', v1);
  // Old paths keep working for existing clients.
  app.use('/api/data', requireApp, require('./routes/data'));

  // Landing page / docs UI
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/api', (req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}`, docs: '/api/docs' }));

  // Errors: always JSON, no stack traces to clients.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large (max 5 MB)' });
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

module.exports = { createApp };
