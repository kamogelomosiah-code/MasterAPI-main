// Schema describing registered client apps, their API keys, rate limits, and lifecycle helpers.
const mongoose = require('mongoose');
const crypto = require('crypto');

const appSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        unique: true,
        maxlength: 100
    },
    description: {
        type: String,
        maxlength: 500,
        default: ''
    },
    apiKey: {
        type: String,
        required: true,
        unique: true,
        default: () => crypto.randomBytes(32).toString('hex')
    },
    isActive: {
        type: Boolean,
        default: true
    },
    rateLimit: {
        requestsPerMinute: {
            type: Number,
            default: 60
        },
        requestsPerHour: {
            type: Number,
            default: 3600
        }
    },
    metadata: {
        type: Map,
        of: mongoose.Schema.Types.Mixed,
        default: () => new Map()
    },
    rateLimitHistory: {
        type: [Date],
        default: () => []
    },
    totalRequests: {
        type: Number,
        default: 0
    },
    lastRequest: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

// Optimized indexes - combined compound index
appSchema.index({ apiKey: 1, isActive: 1 });
appSchema.index({ name: 1, isActive: 1 });
appSchema.index({ createdAt: -1 });

// Optimized static method - remove unnecessary error throwing
appSchema.statics.validateApiKey = async function (apiKey) {
    if (!apiKey) return null;

    return this.findOne({
        apiKey,
        isActive: true
    }, {
        __v: 0, // Exclude version key in projection
        'metadata': 0 // Exclude metadata unless needed
    });
};

// Simplified static method
appSchema.statics.findByName = function (name) {
    return this.findOne({ name, isActive: true });
};

// Optimized instance methods with better error handling
appSchema.methods.regenerateApiKey = async function () {
    this.apiKey = crypto.randomBytes(32).toString('hex');
    this.metadata.set('lastKeyRegeneration', new Date());
    return this.save();
};

appSchema.methods.softDelete = async function () {
    this.isActive = false;
    this.metadata.set('deletedAt', new Date());
    return this.save();
};

// Optimized virtual - only include what's actually useful
appSchema.virtual('stats').get(function () {
    return {
        createdAt: this.createdAt,
        isActive: this.isActive,
        requestLimit: this.rateLimit.requestsPerMinute
    };
});

// Optimized toJSON - only remove what's necessary
appSchema.methods.toJSON = function () {
    const app = this.toObject();

    // Remove internal fields
    delete app.__v;
    delete app._id;

    // Convert Map to Object for JSON serialization
    if (app.metadata instanceof Map) {
        app.metadata = Object.fromEntries(app.metadata);
    }

    // Add virtuals
    app.stats = this.stats;
    app.id = app._id; // Add id field for client compatibility

    return app;
};

// Pre-save middleware for validation
appSchema.pre('save', function (next) {
    if (this.isModified('name')) {
        this.name = this.name.trim();
    }
    next();
});

// Static method for bulk operations
appSchema.statics.findActive = function () {
    return this.find({ isActive: true }).sort({ createdAt: -1 });
};

// Instance method to update metadata safely
appSchema.methods.updateMetadata = function (key, value) {
    this.metadata.set(key, value);
    return this.save();
};

// Query helper for common queries
appSchema.query.active = function () {
    return this.where({ isActive: true });
};

appSchema.query.byApiKey = function (apiKey) {
    return this.where({ apiKey, isActive: true });
};

// Rate limiting and request tracking methods
appSchema.methods.checkRateLimit = async function () {
    const now = Date.now();
    const minuteAgo = now - 60000;
    const hourAgo = now - 3600000;

    // Simple in-memory rate limiting (replace with Redis in production)
    if (!this.rateLimitHistory) this.rateLimitHistory = [];

    // Filter recent requests
    this.rateLimitHistory = this.rateLimitHistory.filter(
        timestamp => timestamp > hourAgo
    );

    const requestsLastMinute = this.rateLimitHistory.filter(
        timestamp => timestamp > minuteAgo
    ).length;

    const requestsLastHour = this.rateLimitHistory.length;

    if (requestsLastMinute >= this.rateLimit.requestsPerMinute ||
        requestsLastHour >= this.rateLimit.requestsPerHour) {
        return {
            allowed: false,
            retryAfter: Math.ceil((minuteAgo + 60000 - now) / 1000)
        };
    }

    return { allowed: true };
};

appSchema.methods.recordRequest = async function () {
    this.rateLimitHistory.push(Date.now());
    this.totalRequests += 1;
    this.lastRequest = new Date();
    await this.save();
};

module.exports = mongoose.model('App', appSchema);