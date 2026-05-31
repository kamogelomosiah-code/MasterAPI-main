const fs = require('fs');
const path = require('path');

// File mapping from old names to new camelCase names
const fileMappings = {
    // Config files
    'config/db.js': 'config/db.js', // Already correct

    // Middleware files
    'middleware/auth.js': 'middleware/auth.js',
    'middleware/audit.js': 'middleware/audit.js',

    // Model files
    'models/App.js': 'models/app.js',
    'models/Database.js': 'models/database.js',
    'models/Collection.js': 'models/collection.js',
    'models/AuditLog.js': 'models/auditLog.js',

    // Route files
    'routes/apps.js': 'routes/appRoutes.js',
    'routes/data.js': 'routes/dataRoutes.js',
    'routes/database.js': 'routes/databaseRoutes.js',
    'routes/ai.js': 'routes/aiRoutes.js',

    // Service files
    'services/huggingface.js': 'services/aiService.js',

    // Utility files
    'utils/document-processor.util.js': 'utils/documentProcessor.js',
    'utils/test.js': 'utils/testUtils.js',

    // Script files
    'scripts/bundle-text.js': 'scripts/bundleText.js'
};

// Create missing directories
const directories = [
    'config',
    'controllers',
    'middleware',
    'models',
    'routes',
    'services',
    'utils',
    'scripts',
    'views',
    'public/css',
    'public/js',
    'public/images',
    'docs'
];

function createDirectories() {
    directories.forEach(dir => {
        const dirPath = path.join(__dirname, '..', dir);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            console.log(`✅ Created directory: ${dir}`);
        }
    });
}

function renameFiles() {
    Object.entries(fileMappings).forEach(([oldPath, newPath]) => {
        const fullOldPath = path.join(__dirname, '..', oldPath);
        const fullNewPath = path.join(__dirname, '..', newPath);

        if (fs.existsSync(fullOldPath)) {
            fs.renameSync(fullOldPath, fullNewPath);
            console.log(`✅ Renamed: ${oldPath} → ${newPath}`);
        } else {
            console.log(`⚠️  File not found: ${oldPath}`);
        }
    });
}

function updateFileReferences() {
    // Files that need import updates
    const filesToUpdate = [
        'index.js',
        'routes/appRoutes.js',
        'routes/dataRoutes.js',
        'routes/databaseRoutes.js',
        'routes/aiRoutes.js',
        'middleware/auth.js'
    ];

    const importMappings = {
        '../models/App': '../models/app',
        '../models/Database': '../models/database',
        '../models/Collection': '../models/collection',
        '../models/AuditLog': '../models/auditLog',
        '../routes/apps': '../routes/appRoutes',
        '../routes/data': '../routes/dataRoutes',
        '../routes/database': '../routes/databaseRoutes',
        '../routes/ai': '../routes/aiRoutes',
        '../services/huggingface': '../services/aiService',
        '../utils/document-processor.util': '../utils/documentProcessor'
    };

    filesToUpdate.forEach(file => {
        const filePath = path.join(__dirname, '..', file);
        if (fs.existsSync(filePath)) {
            let content = fs.readFileSync(filePath, 'utf8');

            Object.entries(importMappings).forEach(([oldImport, newImport]) => {
                const regex = new RegExp(oldImport.replace('/', '\\/'), 'g');
                content = content.replace(regex, newImport);
            });

            fs.writeFileSync(filePath, content);
            console.log(`✅ Updated imports in: ${file}`);
        }
    });
}

function createNewFiles() {
    // Create new controller files with proper structure
    const newFiles = {
        'controllers/appController.js': `const App = require('../models/app');

class AppController {
    async registerApp(req, res) {
        try {
            const { name, description } = req.body;
            const app = new App({ name, description });
            await app.save();
            
            res.status(201).json({
                success: true,
                data: app.toJSON()
            });
        } catch (error) {
            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    }
    
    async getAppInfo(req, res) {
        res.json({
            success: true,
            data: req.authApp
        });
    }
}

module.exports = new AppController();`,

        'controllers/dataController.js': `const { getTenantConnection } = require('../config/db');
const { v4: uuidv4 } = require('uuid');

class DataController {
    async createDocument(req, res) {
        try {
            const { collection } = req.params;
            const db = await getTenantConnection(req.authApp._id.toString());
            const document = {
                _id: uuidv4(),
                ...req.body,
                createdAt: new Date(),
                appId: req.authApp._id
            };
            
            await db.collection(collection).insertOne(document);
            res.status(201).json({ success: true, data: document });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
}

module.exports = new DataController();`,

        'middleware/errorHandler.js': `function errorHandler(err, req, res, next) {
    console.error('Error:', err);
    
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: Object.values(err.errors).map(e => e.message)
        });
    }
    
    if (err.code === 11000) {
        return res.status(409).json({
            success: false,
            error: 'Resource already exists'
        });
    }
    
    res.status(err.status || 500).json({
        success: false,
        error: process.env.NODE_ENV === 'production' 
            ? 'Internal server error' 
            : err.message
    });
}

module.exports = errorHandler;`,

        'docs/apiReference.md': `# API Reference

## Authentication
All requests require API key authentication...

## Data Endpoints
- POST /api/data/:collection - Create document
- GET /api/data/:collection - List documents
- More endpoints...`
    };

    Object.entries(newFiles).forEach(([filePath, content]) => {
        const fullPath = path.join(__dirname, '..', filePath);
        if (!fs.existsSync(fullPath)) {
            fs.writeFileSync(fullPath, content);
            console.log(`✅ Created: ${filePath}`);
        }
    });
}

// Main execution
console.log('🚀 Reorganizing MasterAPI folder structure...\n');

createDirectories();
renameFiles();
updateFileReferences();
createNewFiles();

console.log('\n✅ Folder reorganization complete!');
console.log('📁 New structure:');
console.log(`
MasterAPI/
├── config/          - Configuration
├── controllers/     - Business logic
├── middleware/      - Request processing
├── models/          - Data models
├── routes/          - API endpoints
├── services/        - External services
├── utils/           - Utilities
├── scripts/         - Build tools
├── views/           - Templates
├── public/          - Static assets
├── docs/            - Documentation
└── index.js         - Main entry point
`);
