// CRUD playground for per-app collections using MongoDB
const express = require('express');
const router = express.Router();
const { authenticateApp } = require('../middleware/auth');
const { getTenantConnection } = require('../config/db');
const { v4: uuidv4 } = require('uuid');

// Apply authentication to all data routes
router.use(authenticateApp);

// Simple CRUD operations for app data
router.post('/:collection', async (req, res) => {
    try {
        const { collection } = req.params;
        const data = req.body;

        // Validate collection name
        if (!/^[a-zA-Z0-9_-]{1,50}$/.test(collection)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid collection name. Use only letters, numbers, underscores, and hyphens (max 50 chars)'
            });
        }

        // Get tenant database connection
        const db = await getTenantConnection(req.authApp._id.toString());
        const col = db.collection(collection);

        // Generate unique ID and add metadata
        const document = {
            _id: uuidv4(),
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
            appId: req.authApp._id
        };

        const result = await col.insertOne(document);

        res.status(201).json({
            success: true,
            data: document,
            message: 'Document created successfully'
        });
    } catch (error) {
        console.error('Create document error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create document'
        });
    }
});

router.get('/:collection', async (req, res) => {
    try {
        const { collection } = req.params;
        const { limit = 50, offset = 0, sort = 'createdAt', order = 'desc' } = req.query;

        const db = await getTenantConnection(req.authApp._id.toString());
        const col = db.collection(collection);

        const documents = await col.find({ appId: req.authApp._id })
            .sort({ [sort]: order === 'desc' ? -1 : 1 })
            .skip(parseInt(offset))
            .limit(parseInt(limit))
            .toArray();

        const total = await col.countDocuments({ appId: req.authApp._id });

        res.json({
            success: true,
            data: documents,
            pagination: {
                total,
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
    } catch (error) {
        console.error('List documents error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch documents'
        });
    }
});

router.get('/:collection/:id', async (req, res) => {
    try {
        const { collection, id } = req.params;

        const db = await getTenantConnection(req.authApp._id.toString());
        const col = db.collection(collection);

        const document = await col.findOne({
            _id: id,
            appId: req.authApp._id
        });

        if (!document) {
            return res.status(404).json({
                success: false,
                error: 'Document not found'
            });
        }

        res.json({
            success: true,
            data: document
        });
    } catch (error) {
        console.error('Get document error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch document'
        });
    }
});

router.put('/:collection/:id', async (req, res) => {
    try {
        const { collection, id } = req.params;
        const data = req.body;

        const db = await getTenantConnection(req.authApp._id.toString());
        const col = db.collection(collection);

        const result = await col.findOneAndUpdate(
            { _id: id, appId: req.authApp._id },
            {
                $set: {
                    ...data,
                    updatedAt: new Date()
                }
            },
            { returnDocument: 'after' }
        );

        if (!result.value) {
            return res.status(404).json({
                success: false,
                error: 'Document not found'
            });
        }

        res.json({
            success: true,
            data: result.value,
            message: 'Document updated successfully'
        });
    } catch (error) {
        console.error('Update document error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update document'
        });
    }
});

router.patch('/:collection/:id', async (req, res) => {
    try {
        const { collection, id } = req.params;
        const data = req.body;

        const db = await getTenantConnection(req.authApp._id.toString());
        const col = db.collection(collection);

        const result = await col.findOneAndUpdate(
            { _id: id, appId: req.authApp._id },
            {
                $set: {
                    ...data,
                    updatedAt: new Date()
                }
            },
            { returnDocument: 'after' }
        );

        if (!result.value) {
            return res.status(404).json({
                success: false,
                error: 'Document not found'
            });
        }

        res.json({
            success: true,
            data: result.value,
            message: 'Document patched successfully'
        });
    } catch (error) {
        console.error('Patch document error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to patch document'
        });
    }
});

router.delete('/:collection/:id', async (req, res) => {
    try {
        const { collection, id } = req.params;

        const db = await getTenantConnection(req.authApp._id.toString());
        const col = db.collection(collection);

        const result = await col.findOneAndDelete({
            _id: id,
            appId: req.authApp._id
        });

        if (!result.value) {
            return res.status(404).json({
                success: false,
                error: 'Document not found'
            });
        }

        res.json({
            success: true,
            message: 'Document deleted successfully'
        });
    } catch (error) {
        console.error('Delete document error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete document'
        });
    }
});

// Batch operations for efficiency
router.post('/:collection/batch', async (req, res) => {
    try {
        const { collection } = req.params;
        const { documents } = req.body;

        if (!Array.isArray(documents) || documents.length > 100) {
            return res.status(400).json({
                success: false,
                error: 'Documents must be an array with max 100 items'
            });
        }

        const db = await getTenantConnection(req.authApp._id.toString());
        const col = db.collection(collection);

        const documentsWithMetadata = documents.map(doc => ({
            _id: uuidv4(),
            ...doc,
            createdAt: new Date(),
            updatedAt: new Date(),
            appId: req.authApp._id
        }));

        const result = await col.insertMany(documentsWithMetadata);

        res.status(201).json({
            success: true,
            data: documentsWithMetadata,
            insertedCount: result.insertedCount,
            message: 'Documents created successfully'
        });
    } catch (error) {
        console.error('Batch create error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create documents'
        });
    }
});

module.exports = router;