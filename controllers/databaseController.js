// Owns lifecycle operations for logical databases plus rich stats aggregation helpers.
const Database = require('../models/Database');
const Collection = require('../models/Collection');
const { getDBConnection } = require('../config/db');

class DatabaseController {
    // Create new database
    async createDatabase(req, res) {
        try {
            const { name, description } = req.body;

            if (!name) {
                return res.status(400).json({ error: 'Database name is required' });
            }

            // Check if database already exists
            const existingDb = await Database.findOne({ name, isActive: true });
            if (existingDb) {
                return res.status(409).json({
                    error: 'Database already exists',
                    existingDatabase: existingDb
                });
            }

            // Create database metadata
            const database = await Database.create({
                name,
                description: description || ''
            });

            // Test connection to the new database
            const conn = getDBConnection(name);
            await conn.asPromise();

            res.status(201).json({
                success: true,
                message: `Database '${name}' created successfully`,
                database
            });
        } catch (error) {
            console.error('Create database error:', error);
            res.status(500).json({
                error: 'Failed to create database',
                details: error.message
            });
        }
    }

    // List all databases
    async listDatabases(req, res) {
        try {
            const databases = await Database.findActive();

            const databasesWithStats = await Promise.all(
                databases.map(async (db) => {
                    try {
                        const conn = getDBConnection(db.name);
                        const collections = await conn.db.listCollections().toArray();

                        const collectionStats = await Promise.all(
                            collections.map(async (coll) => {
                                const stats = await conn.db.collection(coll.name).stats();
                                return {
                                    name: coll.name,
                                    documentCount: stats.count,
                                    size: stats.size,
                                    storageSize: stats.storageSize
                                };
                            })
                        );

                        await conn.close();

                        return {
                            ...db.toObject(),
                            collections: collectionStats,
                            totalDocuments: collectionStats.reduce((sum, coll) => sum + coll.documentCount, 0),
                            totalSize: collectionStats.reduce((sum, coll) => sum + coll.size, 0)
                        };
                    } catch (error) {
                        return {
                            ...db.toObject(),
                            error: 'Unable to fetch statistics'
                        };
                    }
                })
            );

            res.json({
                success: true,
                count: databasesWithStats.length,
                databases: databasesWithStats
            });
        } catch (error) {
            res.status(500).json({
                error: 'Failed to fetch databases',
                details: error.message
            });
        }
    }

    // Get database details
    async getDatabase(req, res) {
        try {
            const { dbName } = req.params;

            const database = await Database.findOne({ name: dbName, isActive: true });
            if (!database) {
                return res.status(404).json({ error: 'Database not found' });
            }

            const conn = getDBConnection(dbName);
            const collections = await conn.db.listCollections().toArray();

            const collectionDetails = await Promise.all(
                collections.map(async (coll) => {
                    const stats = await conn.db.collection(coll.name).stats();
                    const sampleDocs = await conn.db.collection(coll.name)
                        .find({})
                        .limit(5)
                        .toArray();

                    return {
                        name: coll.name,
                        stats,
                        sampleDocuments: sampleDocs
                    };
                })
            );

            await conn.close();

            res.json({
                success: true,
                database: {
                    ...database.toObject(),
                    collections: collectionDetails
                }
            });
        } catch (error) {
            res.status(500).json({
                error: 'Failed to fetch database details',
                details: error.message
            });
        }
    }

    // Delete database
    async deleteDatabase(req, res) {
        try {
            const { dbName } = req.params;

            const database = await Database.findOne({ name: dbName, isActive: true });
            if (!database) {
                return res.status(404).json({ error: 'Database not found' });
            }

            // Soft delete the metadata
            await database.softDelete();

            // Also soft delete associated collections
            await Collection.updateMany(
                { databaseName: dbName, isActive: true },
                { isActive: false }
            );

            res.json({
                success: true,
                message: `Database '${dbName}' deleted successfully`
            });
        } catch (error) {
            res.status(500).json({
                error: 'Failed to delete database',
                details: error.message
            });
        }
    }

    // List all collections in a database
    async listCollections(req, res) {
        try {
            const { dbName } = req.params;

            // Verify database exists
            const database = await Database.findOne({ name: dbName, isActive: true });
            if (!database) {
                return res.status(404).json({ error: 'Database not found' });
            }

            const conn = getDBConnection(dbName);
            const collections = await conn.db.listCollections().toArray();

            const collectionStats = await Promise.all(
                collections.map(async (coll) => {
                    const stats = await conn.db.collection(coll.name).stats();
                    const indexes = await conn.db.collection(coll.name).indexes();

                    return {
                        name: coll.name,
                        documentCount: stats.count,
                        size: stats.size,
                        avgDocumentSize: stats.avgObjSize,
                        storageSize: stats.storageSize,
                        indexes: indexes.map(idx => ({
                            name: idx.name,
                            fields: idx.key,
                            unique: !!idx.unique
                        }))
                    };
                })
            );

            await conn.close();

            res.json({
                success: true,
                database: dbName,
                collections: collectionStats
            });
        } catch (error) {
            res.status(500).json({
                error: 'Failed to fetch collections',
                details: error.message
            });
        }
    }
}

module.exports = new DatabaseController();
