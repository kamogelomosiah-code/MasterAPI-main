// Tracks metadata about user collections (field map, counts, soft delete status).
const mongoose = require('mongoose');

const collectionSchema = new mongoose.Schema({
    databaseName: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        default: ''
    },
    documentCount: {
        type: Number,
        default: 0
    },
    fields: {
        type: Map,
        of: String,
        default: new Map()
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Compound index
collectionSchema.index({ databaseName: 1, name: 1 }, { unique: true });
collectionSchema.index({ isActive: 1 });

// Static method to find by database
collectionSchema.statics.findByDatabase = function (databaseName) {
    return this.find({ databaseName, isActive: true }).sort({ name: 1 });
};

// Instance method to soft delete
collectionSchema.methods.softDelete = function () {
    this.isActive = false;
    return this.save();
};

// Method to update field information
collectionSchema.methods.updateFieldInfo = function (document) {
    for (const [key, value] of Object.entries(document)) {
        if (key !== '_id' && key !== '__v') {
            const type = Array.isArray(value) ? 'Array' : typeof value;
            this.fields.set(key, type);
        }
    }
    return this.save();
};

module.exports = mongoose.model('Collection', collectionSchema);
