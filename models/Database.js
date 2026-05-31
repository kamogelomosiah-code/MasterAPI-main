// Metadata for logical tenant databases plus utility methods for stats + lifecycle.
const mongoose = require('mongoose');

const databaseSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
        match: [/^[a-z0-9_]+$/, 'Database name can only contain lowercase letters, numbers, and underscores']
    },
    description: {
        type: String,
        default: '',
        maxlength: 500
    },
    appId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'App',
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    size: {
        type: Number,
        default: 0
    },
    documentCount: {
        type: Number,
        default: 0
    },
    collectionCount: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Indexes
databaseSchema.index({ name: 1 }, { unique: true });
databaseSchema.index({ appId: 1 });
databaseSchema.index({ isActive: 1 });
databaseSchema.index({ createdAt: 1 });

// Static methods
databaseSchema.statics.findByApp = function (appId) {
    return this.find({ appId, isActive: true }).sort({ createdAt: -1 });
};

databaseSchema.statics.findActive = function () {
    return this.find({ isActive: true });
};

// Instance methods
databaseSchema.methods.softDelete = function () {
    this.isActive = false;
    return this.save();
};

databaseSchema.methods.updateStats = async function () {
    try {
        const { getDBConnection } = require('../config/db');
        const conn = getDBConnection(this.name);
        const collections = await conn.db.listCollections().toArray();

        let totalSize = 0;
        let totalDocuments = 0;

        for (const coll of collections) {
            const stats = await conn.db.collection(coll.name).stats();
            totalSize += stats.size;
            totalDocuments += stats.count;
        }

        this.size = totalSize;
        this.documentCount = totalDocuments;
        this.collectionCount = collections.length;

        return this.save();
    } catch (error) {
        console.error('Error updating database stats:', error);
        return this;
    }
};

// Pre-save middleware
databaseSchema.pre('save', function (next) {
    if (this.isModified('name')) {
        this.name = this.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    }
    next();
});

module.exports = mongoose.model('Database', databaseSchema);