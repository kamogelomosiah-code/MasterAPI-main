function errorHandler(err, req, res, next) {
    console.error('Error:', err);

    // MongoDB duplicate key error
    if (err.code === 11000) {
        return res.status(409).json({
            success: false,
            error: 'Resource already exists',
            details: err.keyValue
        });
    }

    // Mongoose validation error
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: Object.values(err.errors).map(e => e.message)
        });
    }

    // Default error
    res.status(err.status || 500).json({
        success: false,
        error: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message
    });
}

module.exports = errorHandler;
