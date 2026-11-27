class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
const bad = (msg, details) => new ApiError(400, msg, details);
const notFound = (what = 'Not found') => new ApiError(404, what);
const unauthorized = (msg = 'Unauthorized') => new ApiError(401, msg);
const forbidden = (msg = 'Forbidden') => new ApiError(403, msg);
/** Wraps an async route so thrown errors reach the error handler. */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
module.exports = { ApiError, bad, notFound, unauthorized, forbidden, ah };
