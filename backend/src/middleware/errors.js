export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function errorHandler(error, req, res, _next) {
  const status = error.status || (error.type === "entity.too.large" ? 413 : 500);

  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.path}:`, error.message);
  }

  res.status(status).json({
    error: status >= 500 && !error.status ? "Internal server error." : error.message
  });
}
