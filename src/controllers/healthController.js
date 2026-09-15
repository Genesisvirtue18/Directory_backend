import { sendSuccess, sendError } from '../utils/response.js';

export const healthController = (config, databaseState) => (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (databaseState() !== 1) return sendError(res, 503, 'Database unavailable');
  return sendSuccess(res, 'Business Directory API is healthy', {
    status: 'ok', database: 'connected', environment: config.NODE_ENV,
    uptime: process.uptime(), timestamp: new Date().toISOString(),
  });
};
