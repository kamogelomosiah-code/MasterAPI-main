const AuditLog = require('../models/AuditLog');

function shouldLogBody(method) {
    return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

module.exports = function auditLogger(req, res, next) {
    const start = Date.now();
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    let responsePayload; let isJson = false;

    res.json = (body) => { responsePayload = body; isJson = true; return originalJson(body); };
    res.send = (body) => { responsePayload = body; return originalSend(body); };

    res.on('finish', async () => {
        try {
            const durationMs = Date.now() - start;
            const log = new AuditLog({
                method: req.method,
                path: req.originalUrl,
                statusCode: res.statusCode,
                durationMs,
                ip: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
                appId: req.authApp?._id,
                apiKey: req.authApp?.apiKey || req.headers['x-api-key'],
                changed: shouldLogBody(req.method),
                requestBody: shouldLogBody(req.method) ? sanitizeBody(req.body) : undefined,
                responseBody: shouldLogBody(req.method) ? sanitizeBody(responsePayload) : undefined,
                error: res.statusCode >= 400 ? (extractError(responsePayload) || `${res.statusCode}`) : undefined,
                meta: new Map([
                    ['userAgent', req.headers['user-agent'] || 'unknown'],
                    ['referer', req.headers['referer'] || null]
                ])
            });
            await log.save();
        } catch (e) {
            // Avoid crashing the request cycle; just log to console
            console.error('Audit log save failed:', e.message);
        }
    });

    next();
};

function sanitizeBody(body) {
    if (!body) return undefined;
    try {
        const clone = JSON.parse(JSON.stringify(body));
        // Remove very large fields
        for (const k of Object.keys(clone)) {
            if (typeof clone[k] === 'string' && clone[k].length > 5000) {
                clone[k] = clone[k].slice(0, 5000) + '...[truncated]';
            }
        }
        return clone;
    } catch {
        return { raw: String(body).slice(0, 5000) };
    }
}

function extractError(payload) {
    if (!payload) return undefined;
    if (typeof payload === 'string') return payload.slice(0, 200);
    if (payload.error) return String(payload.error).slice(0, 200);
    if (payload.message) return String(payload.message).slice(0, 200);
    return undefined;
}
