/**
 * MasterAPI Demo Server - Works without MongoDB
 * Uses file-based storage for demo purposes
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory storage for demo
const apps = new Map();
const appData = new Map();

// Load initial data if exists
function loadData() {
  try {
    const appsFile = path.join(DATA_DIR, 'apps.json');
    const dataFile = path.join(DATA_DIR, 'data.json');

    if (fs.existsSync(appsFile)) {
      const appsData = JSON.parse(fs.readFileSync(appsFile, 'utf8'));
      appsData.forEach(app => apps.set(app.id, app));
    }

    if (fs.existsSync(dataFile)) {
      const allData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      Object.entries(allData).forEach(([appId, items]) => {
        appData.set(appId, new Map(items.map(item => [item._id, item])));
      });
    }
  } catch (err) {
    console.error('Failed to load data:', err.message);
  }
}

// Save data to disk
function saveData() {
  try {
    const appsArray = Array.from(apps.values());
    fs.writeFileSync(
      path.join(DATA_DIR, 'apps.json'),
      JSON.stringify(appsArray, null, 2)
    );

    const dataObj = {};
    appData.forEach((items, appId) => {
      dataObj[appId] = Array.from(items.values());
    });
    fs.writeFileSync(
      path.join(DATA_DIR, 'data.json'),
      JSON.stringify(dataObj, null, 2)
    );
  } catch (err) {
    console.error('Failed to save data:', err.message);
  }
}

// Middleware to authenticate API key
const authenticateApp = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: 'API key required. Use X-API-Key header or apiKey query parameter'
    });
  }

  let app = null;
  for (const [id, appData] of apps.entries()) {
    if (appData.apiKey === apiKey) {
      app = appData;
      break;
    }
  }

  if (!app) {
    return res.status(401).json({
      success: false,
      error: 'Invalid API key'
    });
  }

  req.authApp = app;
  next();
};

// ========== API ROUTES ==========

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mode: 'demo'
  });
});

// API info
app.get('/api/info', (req, res) => {
  res.json({
    name: 'MasterAPI Demo',
    version: '1.0.0',
    description: 'Full-stack API service with file-based data storage',
    mode: 'demo',
    endpoints: {
      apps: '/api/apps',
      data: '/api/data',
      health: '/api/health'
    },
    storage: 'File-based (no MongoDB required)'
  });
});

// Register app
app.post('/api/apps/register', (req, res) => {
  const { name, description } = req.body;

  if (!name) {
    return res.status(400).json({
      success: false,
      error: 'App name is required'
    });
  }

  // Check if app already exists
  for (const app of apps.values()) {
    if (app.name === name) {
      return res.status(400).json({
        success: false,
        error: 'App name already exists'
      });
    }
  }

  const id = uuidv4();
  const apiKey = crypto.randomBytes(32).toString('hex');

  const newApp = {
    id,
    name,
    description: description || '',
    apiKey,
    createdAt: new Date().toISOString(),
    isActive: true
  };

  apps.set(id, newApp);
  appData.set(id, new Map());
  saveData();

  res.json({
    success: true,
    app: {
      id,
      name,
      apiKey,
      createdAt: newApp.createdAt
    }
  });
});

// Get all apps
app.get('/api/apps', (req, res) => {
  const appList = Array.from(apps.values()).map(app => ({
    id: app.id,
    name: app.name,
    createdAt: app.createdAt,
    isActive: app.isActive
  }));

  res.json({
    success: true,
    apps: appList,
    count: appList.length
  });
});

// Get app by API key
app.get('/api/apps/me', authenticateApp, (req, res) => {
  res.json({
    success: true,
    app: {
      id: req.authApp.id,
      name: req.authApp.name,
      createdAt: req.authApp.createdAt
    }
  });
});

// Save data (POST /api/data/items)
app.post('/api/data/items', authenticateApp, (req, res) => {
  const data = req.body;
  const appId = req.authApp.id;

  if (!appData.has(appId)) {
    appData.set(appId, new Map());
  }

  const id = uuidv4();
  const document = {
    _id: id,
    ...data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    appId
  };

  appData.get(appId).set(id, document);
  saveData();

  res.status(201).json({
    success: true,
    data: document,
    message: 'Document created successfully'
  });
});

// Get data (GET /api/data/items)
app.get('/api/data/items', authenticateApp, (req, res) => {
  const appId = req.authApp.id;
  const { limit = 50, offset = 0 } = req.query;

  const items = appData.get(appId);
  const documents = items ? Array.from(items.values()) : [];
  const paginated = documents.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

  res.json({
    success: true,
    data: paginated,
    pagination: {
      total: documents.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    }
  });
});

// Get single item (GET /api/data/items/:id)
app.get('/api/data/items/:id', authenticateApp, (req, res) => {
  const { id } = req.params;
  const appId = req.authApp.id;

  const items = appData.get(appId);
  if (!items || !items.has(id)) {
    return res.status(404).json({
      success: false,
      error: 'Document not found'
    });
  }

  res.json({
    success: true,
    data: items.get(id)
  });
});

// Update item (PUT /api/data/items/:id)
app.put('/api/data/items/:id', authenticateApp, (req, res) => {
  const { id } = req.params;
  const appId = req.authApp.id;
  const data = req.body;

  const items = appData.get(appId);
  if (!items || !items.has(id)) {
    return res.status(404).json({
      success: false,
      error: 'Document not found'
    });
  }

  const existing = items.get(id);
  const updated = {
    ...existing,
    ...data,
    updatedAt: new Date().toISOString()
  };

  items.set(id, updated);
  saveData();

  res.json({
    success: true,
    data: updated,
    message: 'Document updated successfully'
  });
});

// Delete item (DELETE /api/data/items/:id)
app.delete('/api/data/items/:id', authenticateApp, (req, res) => {
  const { id } = req.params;
  const appId = req.authApp.id;

  const items = appData.get(appId);
  if (!items || !items.has(id)) {
    return res.status(404).json({
      success: false,
      error: 'Document not found'
    });
  }

  items.delete(id);
  saveData();

  res.json({
    success: true,
    message: 'Document deleted successfully'
  });
});

// ========== FRONTEND ROUTES ==========

// Home page (welcome screen)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl
  });
});

// Start server
app.listen(PORT, () => {
  console.log('\n🚀 MasterAPI Demo Server');
  console.log(`📱 Frontend: http://localhost:${PORT}`);
  console.log(`🔗 API: http://localhost:${PORT}/api`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`💾 Storage: File-based (data directory)\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n📌 Server stopped');
  process.exit(0);
});
