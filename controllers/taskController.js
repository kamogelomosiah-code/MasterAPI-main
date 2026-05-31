// TaskController accepts dynamic REST-style URIs, translates them into MongoDB actions, and executes them.
const { getDBConnection } = require('../config/db');
const Database = require('../models/Database');
const Collection = require('../models/Collection');
const { ObjectId } = require('mongodb');

class TaskController {
    // Interpret a “/db/collection/operation/id” URI pattern into actionable parts
    parseURI(uri) {
        const parts = uri.replace(/^\/+|\/+$/g, '').split('/');

        if (parts.length < 2) {
            throw new Error('URI must contain at least database and collection');
        }

        const task = {
            database: parts[0],
            collection: parts[1],
            operation: 'find',
            documentId: null
        };

        if (parts.length > 2) {
            const thirdPart = parts[2];

            // Check if it's an operation
            const operations = ['create', 'read', 'update', 'delete', 'find', 'insert', 'count', 'aggregate'];
            if (operations.includes(thirdPart)) {
                task.operation = thirdPart;
                if (parts.length > 3) {
                    task.documentId = parts[3];
                }
            } else {
                // Assume it's a document ID
                task.documentId = thirdPart;
                task.operation = 'read';
            }
        }

        return task;
    }

    // Convert filter/option/data query parameters into structured objects
    parseQuery(query) {
        const filters = {};
        const options = {};
        const data = {};

        for (const [key, value] of Object.entries(query)) {
            if (key.startsWith('filter.')) {
                const field = key.replace('filter.', '');
                filters[field] = this.parseValue(value);
            } else if (key.startsWith('option.')) {
                const option = key.replace('option.', '');
                options[option] = this.parseValue(value);
            } else if (key.startsWith('data.')) {
                const field = key.replace('data.', '');
                data[field] = this.parseValue(value);
            } else if (['limit', 'skip', 'sort'].includes(key)) {
                options[key] = this.parseValue(value);
            }
        }

        return { filters, options, data };
    }

    // Convert string primitives to booleans, numbers, JSON, etc.
    parseValue(value) {
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (value === 'null') return null;
        if (value === 'undefined') return undefined;

        if (!isNaN(value) && value.trim() !== '') {
            return Number(value);
        }

        try {
            return JSON.parse(value);
        } catch (e) {
            return value;
        }
    }

    // Main entry: resolve URI + query + body into a MongoDB action and return the result
    async processTask(req, res) {
        try {
            const { uri } = req.params;
            const { method, body, query } = req;

            console.log(`🔧 Processing task: ${method} ${uri}`);

            // Parse URI into task
            const task = this.parseURI(uri);

            // Parse query parameters
            const { filters, options, data: queryData } = this.parseQuery(query);

            // Merge data from body and query
            const data = { ...queryData, ...body };

            // Determine operation from HTTP method if not specified in URI
            if (!task.operation || task.operation === 'read') {
                task.operation = this.getOperationFromMethod(method, task.documentId);
            }

            // Execute the task
            const result = await this.executeTask(task, filters, options, data, method);

            res.json({
                success: true,
                task: {
                    uri,
                    operation: task.operation,
                    database: task.database,
                    collection: task.collection,
                    documentId: task.documentId
                },
                ...result
            });

        } catch (error) {
            console.error('Task processing error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
                task: { uri: req.params.uri }
            });
        }
    }

    // Map HTTP verb to default CRUD verb when operation isn’t explicitly specified
    getOperationFromMethod(method, hasDocumentId) {
        switch (method.toUpperCase()) {
            case 'GET':
                return hasDocumentId ? 'findOne' : 'find';
            case 'POST':
                return 'insert';
            case 'PUT':
            case 'PATCH':
                return 'update';
            case 'DELETE':
                return 'delete';
            default:
                return 'find';
        }
    }

    // Perform the requested MongoDB operation on the target database/collection
    async executeTask(task, filters, options, data, httpMethod) {
        const { database, collection, operation, documentId } = task;

        // Get database connection
        const conn = getDBConnection(database);
        const db = conn.db;
        const coll = db.collection(collection);

        let result;

        switch (operation) {
            case 'find':
            case 'read':
                // Query documents (single or many) based on filters/documentId
                if (documentId) {
                    try {
                        result = await coll.findOne({ _id: new ObjectId(documentId) });
                    } catch (e) {
                        result = await coll.findOne({ _id: documentId });
                    }
                    return { document: result };
                } else {
                    const query = this.buildQuery(filters);
                    const cursor = coll.find(query);

                    if (options.sort) cursor.sort(options.sort);
                    if (options.skip) cursor.skip(parseInt(options.skip));
                    if (options.limit) cursor.limit(parseInt(options.limit));

                    const documents = await cursor.toArray();
                    const count = await coll.countDocuments(query);

                    return {
                        documents,
                        count,
                        query,
                        options
                    };
                }

            case 'insert':
            case 'create':
                // Create a document and refresh collection metadata
                data.createdAt = new Date();
                data.updatedAt = new Date();

                const insertResult = await coll.insertOne(data);
                const insertedDoc = await coll.findOne({ _id: insertResult.insertedId });

                await this.updateCollectionMetadata(database, collection);

                return {
                    message: 'Document created successfully',
                    insertedId: insertResult.insertedId,
                    document: insertedDoc
                };

            case 'update':
                // Update matching documents (replace or $set) and return changed docs
                let updateFilter;
                try {
                    updateFilter = documentId ?
                        { _id: new ObjectId(documentId) } :
                        this.buildQuery(filters);
                } catch (e) {
                    updateFilter = documentId ?
                        { _id: documentId } :
                        this.buildQuery(filters);
                }

                data.updatedAt = new Date();

                const updateOps = this.buildUpdate(data, httpMethod === 'PUT' ? 'replace' : 'set');

                const updateResult = await coll.updateMany(
                    updateFilter,
                    httpMethod === 'PUT' ? data : updateOps,
                    { upsert: options.upsert || false }
                );

                const updatedDocs = await coll.find(updateFilter).toArray();

                return {
                    message: `Updated ${updateResult.modifiedCount} document(s)`,
                    modifiedCount: updateResult.modifiedCount,
                    upsertedCount: updateResult.upsertedCount,
                    documents: updatedDocs
                };

            case 'delete':
            case 'remove':
                // Remove matching documents and update metadata if anything was deleted
                let deleteFilter;
                try {
                    deleteFilter = documentId ?
                        { _id: new ObjectId(documentId) } :
                        this.buildQuery(filters);
                } catch (e) {
                    deleteFilter = documentId ?
                        { _id: documentId } :
                        this.buildQuery(filters);
                }

                const deleteResult = await coll.deleteMany(deleteFilter);

                if (deleteResult.deletedCount > 0) {
                    await this.updateCollectionMetadata(database, collection);
                }

                return {
                    message: `Deleted ${deleteResult.deletedCount} document(s)`,
                    deletedCount: deleteResult.deletedCount
                };

            case 'count':
                // Return the total count matching the provided filters
                const countQuery = this.buildQuery(filters);
                const count = await coll.countDocuments(countQuery);
                return { count, query: countQuery };

            case 'createCollection':
                // Ensure a collection exists and track it in metadata models
                const collections = await db.listCollections({ name: collection }).toArray();
                if (collections.length === 0) {
                    await db.createCollection(collection);
                    await this.createCollectionMetadata(database, collection);
                    return { message: `Collection '${collection}' created successfully` };
                } else {
                    return { message: `Collection '${collection}' already exists` };
                }

            default:
                throw new Error(`Unsupported operation: ${operation}`);
        }
    }

    // Helper: build a MongoDB filter object from parsed filter fields
    buildQuery(filters) {
        const query = {};

        for (const [field, value] of Object.entries(filters)) {
            if (typeof value === 'object' && value !== null) {
                query[field] = value;
            } else {
                query[field] = value;
            }
        }

        return query;
    }

    // Helper: convert plain data into update operators (or full replacement)
    buildUpdate(data, operation = 'set') {
        if (operation === 'replace') {
            return data;
        }

        const updateOps = {};

        for (const [key, value] of Object.entries(data)) {
            if (key.startsWith('$')) {
                updateOps[key] = value;
            } else {
                if (!updateOps.$set) updateOps.$set = {};
                updateOps.$set[key] = value;
            }
        }

        return updateOps;
    }

    // Sync collection statistics with the metadata collection model
    async updateCollectionMetadata(databaseName, collectionName) {
        try {
            const conn = getDBConnection(databaseName);
            const count = await conn.db.collection(collectionName).countDocuments();

            let collectionMeta = await Collection.findOne({
                databaseName,
                name: collectionName
            });

            if (collectionMeta) {
                collectionMeta.documentCount = count;
                collectionMeta.updatedAt = new Date();
                await collectionMeta.save();
            } else {
                await this.createCollectionMetadata(databaseName, collectionName);
            }

            await conn.close();
        } catch (error) {
            console.error('Error updating collection metadata:', error);
        }
    }

    // Create metadata records for brand-new collections
    async createCollectionMetadata(databaseName, collectionName) {
        try {
            await Collection.create({
                databaseName,
                name: collectionName,
                documentCount: 0
            });

            let databaseMeta = await Database.findOne({ name: databaseName });
            if (databaseMeta) {
                await databaseMeta.addCollection(collectionName);
            } else {
                await Database.create({
                    name: databaseName,
                    collections: [{ name: collectionName, documentCount: 0, createdAt: new Date() }]
                });
            }
        } catch (error) {
            console.error('Error creating collection metadata:', error);
        }
    }
}

module.exports = new TaskController();
