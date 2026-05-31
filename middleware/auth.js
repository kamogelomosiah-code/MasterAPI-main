// API-key authentication + lightweight per-app rate limiting lives here.
const App = require('../models/App');

const authenticateApp = async (req, res, next) => {
    try {
        const apiKey = req.headers['x-api-key'] || req.query.apiKey;

        if (!apiKey) {
            return res.status(401).json({
                success: false,
                error: 'API key required. Use X-API-Key header or apiKey query parameter'
            });
        }

        // Find active app with the API key
        const app = await App.findOne({
            apiKey: apiKey,
            isActive: true
        });

        if (!app) {
            return res.status(401).json({
                success: false,
                error: 'Invalid or inactive API key'
            });
        }

        // Check rate limits
        const rateLimitResult = await app.checkRateLimit();
        if (!rateLimitResult.allowed) {
            return res.status(429).json({
                success: false,
                error: 'Rate limit exceeded',
                retryAfter: rateLimitResult.retryAfter
            });
        }

        // Record the request
        await app.recordRequest();

        // Attach app to request
        req.authApp = app;
        next();
    } catch (error) {
        console.error('Authentication error:', error);
        res.status(500).json({
            success: false,
            error: 'Authentication failed'
        });
    }
};

module.exports = {
    authenticateApp
};