// Handles CRUD convenience helpers for user-created collections plus metadata sync with Mongo.
const Collection = require('../models/Collection');
const Database = require('../models/Database');
const { getDBConnection } = require('../config/db');

class CollectionController {
    // Create new collection
    async createCollection(req, res) {
        try {
            const { dbName } = req.params;
            const { name, description } = req.body;

            if (!name) {
                return res.status(400).json({ error: 'Collection name is required' });
            }

            // Verify database exists
            const database = await Database.findOne({ name: dbName, isActive: true });
            if (!database) {
                return res.status(404).json({ error: 'Database not found' });
            }

            // Check if collection already exists
            const existingCollection = await Collection.findOne({
                databaseName: dbName,
                name,
                isActive: true
            });

            if (existingCollection) {
                return res.status(409).json({
                    error: 'Collection already exists in this database',
                    existingCollection
                });
            }

            // Create the collection by inserting a test document
            const conn = getDBConnection(dbName);
            const collection = conn.db.collection(name);

            // Create collection by inserting and immediately removing a test document
            const testDoc = {
                _createdAt: new Date(),
                _test: true,
                message: 'Test document for collection creation'
            };

            const result = await collection.insertOne(testDoc);
            await collection.deleteOne({ _id: result.insertedId });

            // Create collection metadata
            const collectionMeta = await Collection.create({
                databaseName: dbName,
                name,
                description: description || ''
            });

            // Update database metadata
            await database.addCollection(name);

            await conn.close();

            res.status(201).json({
                success: true,
                message: `Collection '${name}' created in database '${dbName}'`,
                collection: collectionMeta
            });
        } catch (error) {
            console.error('Create collection error:', error);
            res.status(500).json({
                error: 'Failed to create collection',
                details: error.message
            });
        }
    }

    // Quick insert document
    async quickInsert(req, res) {
        try {
            const { dbName, collectionName } = req.params;
            const document = req.body;

            if (!document || typeof document !== 'object') {
                return res.status(400).json({ error: 'Valid document data is required' });
            }

            const conn = getDBConnection(dbName);
            const collection = conn.db.collection(collectionName);

            // Add timestamp if not provided
            if (!document.createdAt) {
                document.createdAt = new Date();
            }
            document.updatedAt = new Date();

            const result = await collection.insertOne(document);

            // Update collection metadata
            const collectionMeta = await Collection.findOne({
                databaseName: dbName,
                name: collectionName
            });

            if (collectionMeta) {
                collectionMeta.documentCount += 1;
                collectionMeta.updateFieldInfo(document);
                await collectionMeta.save();
            }

            await conn.close();

            res.status(201).json({
                success: true,
                message: 'Document inserted successfully',
                insertedId: result.insertedId,
                document: { _id: result.insertedId, ...document }
            });
        } catch (error) {
            console.error('Quick insert error:', error);
            res.status(500).json({
                error: 'Failed to insert document',
                details: error.message
            });
        }
    }

    // Quick find documents
    async quickFind(req, res) {
        try {
            const { dbName, collectionName } = req.params;
            const query = req.query;

            const conn = getDBConnection(dbName);
            const collection = conn.db.collection(collectionName);

            // Build query from URL parameters
            const mongoQuery = {};
            Object.keys(query).forEach(key => {
                if (key !== 'limit' && key !== 'skip' && key !== 'sort') {
                    try {
                        mongoQuery[key] = JSON.parse(query[key]);
                    } catch (e) {
                        mongoQuery[key] = query[key];
                    }
                }
            });

            const cursor = collection.find(mongoQuery);

            if (query.limit) cursor.limit(parseInt(query.limit));
            if (query.skip) cursor.skip(parseInt(query.skip));
            if (query.sort) {
                try {
                    cursor.sort(JSON.parse(query.sort));
                } catch (e) {
                    // Ignore sort if invalid
                }
            }

            const documents = await cursor.toArray();
            const count = await collection.countDocuments(mongoQuery);

            await conn.close();

            res.json({
                success: true,
                database: dbName,
                collection: collectionName,
                query: mongoQuery,
                count,
                documents
            });
        } catch (error) {
            console.error('Quick find error:', error);
            res.status(500).json({
                error: 'Failed to find documents',
                details: error.message
            });
        }
    }

    // Quick update document
    async quickUpdate(req, res) {
        try {
            const { dbName, collectionName, documentId } = req.params;
            const updateData = req.body;

            if (!updateData || typeof updateData !== 'object') {
                return res.status(400).json({ error: 'Valid update data is required' });
            }

            const conn = getDBConnection(dbName);
            const collection = conn.db.collection(collectionName);

            updateData.updatedAt = new Date();

            const result = await collection.findOneAndUpdate(
                { _id: documentId },
                { $set: updateData },
                { returnDocument: 'after' }
            );

            if (!result.value) {
                await conn.close();
                return res.status(404).json({ error: 'Document not found' });
            }

            await conn.close();

            res.json({
                success: true,
                message: 'Document updated successfully',
                document: result.value
            });
        } catch (error) {
            console.error('Quick update error:', error);
            res.status(500).json({
                error: 'Failed to update document',
                details: error.message
            });
        }
    }

    // Quick delete document
    async quickDelete(req, res) {
        try {
            const { dbName, collectionName, documentId } = req.params;

            const conn = getDBConnection(dbName);
            const collection = conn.db.collection(collectionName);

            const result = await collection.findOneAndDelete({
                _id: documentId
            });

            if (!result.value) {
                await conn.close();
                return res.status(404).json({ error: 'Document not found' });
            }

            // Update collection count
            const collectionMeta = await Collection.findOne({
                databaseName: dbName,
                name: collectionName
            });

            if (collectionMeta) {
                collectionMeta.documentCount = Math.max(0, collectionMeta.documentCount - 1);
                await collectionMeta.save();
            }

            await conn.close();

            res.json({
                success: true,
                message: 'Document deleted successfully',
                deletedDocument: result.value
            });
        } catch (error) {
            console.error('Quick delete error:', error);
            res.status(500).json({
                error: 'Failed to delete document',
                details: error.message
            });
        }
    }
}

module.exports = new CollectionController();
