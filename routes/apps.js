// Demo-only app registration + API-key management endpoints (uses MongoDB).
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const App = require('../models/App');

// Register new app
router.post('/register', async (req, res) => {
    try {
        const { name, description } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'App name is required' });
        }

        // Use the App model directly
        const app = new App({
            name,
            description: description || '',
            rateLimit: {
                requestsPerMinute: 60,
                requestsPerHour: 1000
            }
        });

        await app.save();

        res.json({
            success: true,
            app: {
                id: app._id,
                name: app.name,
                apiKey: app.apiKey, // Only returned once!
                createdAt: app.createdAt
            }
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// Get all registered apps
router.get('/', async (req, res) => {
    try {
        const apps = await App.find({ isActive: true });

        res.json({
            success: true,
            apps: apps.map(app => ({
                id: app._id,
                name: app.name,
                createdAt: app.createdAt,
                isActive: app.isActive
            })),
            count: apps.length
        });
    } catch (error) {
        console.error('Get apps error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get app by API key
router.get('/me', async (req, res) => {
    try {
        const apiKey = req.headers.authorization?.replace('Bearer ', '');

        if (!apiKey) {
            return res.status(401).json({ error: 'API key required' });
        }

        const app = await App.findOne({ apiKey, isActive: true });

        if (!app) {
            return res.status(404).json({ error: 'App not found or inactive' });
        }

        res.json({
            success: true,
            app: {
                id: app._id,
                name: app.name,
                createdAt: app.createdAt
            }
        });
    } catch (error) {
        console.error('Get app error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;