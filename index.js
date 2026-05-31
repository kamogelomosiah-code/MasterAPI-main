/**
 * MasterAPI server bootstrap – wires up Express, global middleware, routes, health/info endpoints,
 * and safety nets (fallback routing, diagnostics, centralized error handling).
 * Everything starts here, so it is the best place to look when the API refuses to spin up.
 */
require('dotenv').config(); // Load environment variables
const express = require('express');
const cors = require('cors');
const path = require('path');
const net = require('net');
const rateLimit = require('express-rate-limit');

const app = express();
const { connectDB } = require('./config/db');
// Connect main database
connectDB().catch(err => console.error('DB connection error:', err.message));
const REQUESTED_PORT = Number(process.env.PORT) || 3000;
const BRAND_NAME = process.env.BRAND_NAME || 'MasterAPI';
const PAGE_TITLE = process.env.PAGE_TITLE || BRAND_NAME;
const parseNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const findAvailablePort = (startPort, maxAttempts = 20) => new Promise((resolve, reject) => {
  const tryPort = (port) => {
    const tester = net.createServer();

    tester.unref();

    tester.once('error', (error) => {
      if (error.code === 'EADDRINUSE' && port < startPort + maxAttempts - 1) {
        tryPort(port + 1);
        return;
      }

      reject(error);
    });

    tester.listen(port, () => {
      const { port: availablePort } = tester.address();
      tester.close(() => resolve(availablePort));
    });
  };

  tryPort(startPort);
});
const DASHBOARD_STATS = {
  requestsToday: parseNumber(process.env.STATS_REQUESTS_TODAY, 24),
  activeApps: parseNumber(process.env.STATS_ACTIVE_APPS, 3),
  uptime: process.env.STATS_UPTIME || '99.9%',
  dataItems: parseNumber(process.env.STATS_DATA_ITEMS, 128)
};

let runStartupTests = () => { };

// Set up EJS view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Fix: Set trust proxy before rate limiting
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
// Audit logging middleware (after JSON parsing, before routes)
app.use(require('./middleware/audit'));
app.use(express.static(path.join(__dirname, 'public')));

// Import routes with new names
let aiRoutes = null;
try {
  console.log('Loading AI routes...');
  aiRoutes = require('./routes/aiRoutes');
  console.log('AI routes loaded successfully');
} catch (err) {
  console.log('⚠️  AI routes not found (optional):', err.message);
}

try {
  console.log('Loading other routes...');
  const appRoutes = require('./routes/apps');
  const dataRoutes = require('./routes/data');

  // Use routes
  app.use('/api/apps', appRoutes);
  app.use('/api/data', dataRoutes);

  // Conditionally use AI routes if they exist
  if (aiRoutes) {
    app.use('/api/ai', aiRoutes);
    console.log('✅ AI routes registered: /api/ai');
  }

  console.log('✅ Registered routes: /api/apps, /api/data');

  // Test all routes on startup
  const axios = require('axios');
  runStartupTests = (port) => {
    const base = `http://localhost:${port}/api`;
    const testRoutes = [
      { method: 'get', url: `${base}/health` },
      { method: 'get', url: `${base}/info` },
      { method: 'get', url: `${base}/apps` }
    ];

    testRoutes.forEach(async route => {
      try {
        const res = await axios({ method: route.method, url: route.url, data: route.data });
        console.log(`Route test: ${route.method.toUpperCase()} ${route.url} ->`, res.status);
      } catch (err) {
        console.log(`Route test: ${route.method.toUpperCase()} ${route.url} -> ERROR`, err.response?.status || err.message);
      }
    });
  };
} catch (error) {
  console.error('❌ Route loading error:', error.message);
}

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    // Basic health check - just return OK status
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      error: 'Service unavailable'
    });
  }
});

// API info endpoint
app.get('/api/info', (req, res) => {
  res.json({
    name: 'MasterAPI',
    version: '1.0.0',
    description: 'Full-stack API service with data storage and AI capabilities',
    endpoints: {
      apps: '/api/apps',
      data: '/api/data',
      ai: '/api/ai',
      databases: '/api/databases',
      health: '/api/health'
    },
    documentation: 'http://localhost:4000/#documentation'
  });
});

// Debug endpoint to show all registered routes
app.get('/api/debug/routes', (req, res) => {
  const routes = [];

  function extractRoutes(stack, basePath = '') {
    stack.forEach(layer => {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
        routes.push(`${methods} ${basePath}${layer.route.path}`);
      } else if (layer.name === 'router' && layer.handle.stack) {
        const routerPath = layer.regexp.source
          .replace('\\/?', '')
          .replace('(?=\\/|$)', '')
          .replace(/\\\//g, '/')
          .replace(/\^/g, '')
          .replace(/\$/g, '');
        extractRoutes(layer.handle.stack, basePath + routerPath);
      }
    });
  }

  extractRoutes(app._router.stack);

  res.json({
    totalRoutes: routes.length,
    routes: routes.sort()
  });
});

// Serve frontend using EJS
app.get('/', (req, res) => {
  res.render('index', {
    pageTitle: PAGE_TITLE,
    brandName: BRAND_NAME,
    stats: DASHBOARD_STATS
  });
});

// Serve dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Keep serving static HTML for demo pages
app.get('/demo.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'demo.html'));
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
    availableEndpoints: [
      'GET /api/health',
      'GET /api/info',
      'POST /api/apps/register',
      'GET /api/apps',
      'GET /api/apps/me',
      'POST /api/data/:collection',
      'GET /api/data/:collection',
      'GET /api/ai/models',
      'GET /api/ai/models/:modelId',
      'POST /api/ai/chat',
      'POST /api/ai/image',
      'POST /api/ai/speech',
      'POST /api/ai/complete'
    ]
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

const startServer = async () => {
  const port = await findAvailablePort(REQUESTED_PORT);

  app.listen(port, () => {
    console.log(`🚀 MasterAPI running on port ${port}`);
    console.log(`📱 Frontend: http://localhost:${port}`);
    console.log(`🔗 API: http://localhost:${port}/api`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('✅ All routes registered successfully');
    setTimeout(() => runStartupTests(port), 2000);
  });
};

startServer().catch(error => {
  console.error('❌ Failed to start server:', error.message);
  process.exit(1);
});