import { AppError } from '../utils/AppError.js';
import { sendError } from '../utils/response.js';

export function notFound(req, res, next) {
  next(new AppError('Route not found', 404));
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  let status = 500;
  let message = 'Internal server error';
  let errors = [];
  if (error instanceof AppError) {
    ({ statusCode: status, message, errors } = error);
  } else if (error.name === 'ValidationError') {
    status = 400;
    message = 'Validation failed';
    errors = Object.keys(error.errors).map(field => ({ field, message: 'Invalid or missing value' }));
  } else if (error.code === 11000) {
    status = 409;
    message = 'A record with this unique value already exists';
  } else if (error.name === 'CastError') {
    status = 400;
    message = 'Invalid field value or identifier';
  } else if (error.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON request';
  } else if (error.type === 'entity.too.large') {
    status = 413;
    message = 'Request body is too large';
  } else if (error.status >= 400 && error.status < 500) {
    status = error.status;
    message = 'Invalid request';
  }
  if (status >= 500) {
    // Never log raw errors: driver messages and stacks can contain connection credentials.
    console.error('Request failed', { status, type: error.name || 'Error' });
    if (req.app.get('env') === 'development') {
      errors = [{
        type: error.name || 'Error',
        ...(error instanceof TypeError ? { message: error.message } : {}),
      }];
    }
  }
  return sendError(res, status, message, errors);
}
