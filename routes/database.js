// Simple informational routes that mimic database health + metadata responses.
const express = require('express');
const router = express.Router();

// Database health check and info
router.get('/health', async (req, res) => {
    try {
        res.json({
            success: true,
            database: 'MasterAPI Database',
            status: 'connected',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Database health check error:', error);
        res.status(500).json({ error: 'Database connection error' });
    }
});

router.get('/info', async (req, res) => {
    try {
        res.json({
            success: true,
            database: {
                name: 'MasterAPI Storage',
                version: '1.0.0',
                type: 'In-Memory (Demo)',
                features: ['CRUD Operations', 'Collections', 'API Key Authentication'],
                limits: {
                    maxCollections: 100,
                    maxItemsPerCollection: 10000,
                    maxItemSize: '1MB'
                }
            }
        });
    } catch (error) {
        console.error('Database info error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;