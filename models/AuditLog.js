const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    method: { type: String, required: true },
    path: { type: String, required: true },
    statusCode: { type: Number, required: true },
    durationMs: { type: Number, required: true },
    ip: { type: String },
    appId: { type: mongoose.Schema.Types.ObjectId, ref: 'App' },
    apiKey: { type: String },
    changed: { type: Boolean, default: false },
    requestBody: { type: mongoose.Schema.Types.Mixed },
    responseBody: { type: mongoose.Schema.Types.Mixed },
    error: { type: String },
    meta: { type: Map, of: mongoose.Schema.Types.Mixed, default: () => new Map() }
}, { timestamps: true });

auditLogSchema.index({ path: 1, method: 1, createdAt: -1 });
auditLogSchema.index({ appId: 1, createdAt: -1 });
auditLogSchema.index({ changed: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
