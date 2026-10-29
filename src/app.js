import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { isIP } from 'node:net';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import mongoose from 'mongoose';
import { apiRouter } from './routes/index.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { sendError } from './utils/response.js';

export function createApp(config, { databaseState = () => mongoose.connection.readyState, logging = true, rateLimitMax = 100, placesService } = {}) {
  const app = express();
  app.set('env', config.NODE_ENV);
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY ? config.TRUST_PROXY.split(',').map(value => value.trim()) : false);
  app.use(helmet());
  app.use(cors({ origin: [config.CLIENT_URL, config.CLIENT_URL_2].filter(Boolean) }));
  // Omit URLs, queries, headers and bodies to avoid recording future auth tokens or PII.
  if (logging) app.use(morgan(':method :status :res[content-length] - :response-time ms'));
  app.use('/api/v1', rateLimit({
    windowMs: 15 * 60 * 1000, limit: rateLimitMax,
    standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: req => {
      const cloudflareIp = req.get('cf-connecting-ip')?.trim();
      const clientIp = config.NODE_ENV === 'production' && cloudflareIp && isIP(cloudflareIp)
        ? cloudflareIp
        : req.ip;
      return ipKeyGenerator(clientIp);
    },
    handler: (req, res) => sendError(res, 429, 'Too many requests, please try again later'),
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb', parameterLimit: 100 }));
  app.use('/uploads', express.static(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads'), { maxAge: '7d', fallthrough: false }));
  app.use('/api/v1', apiRouter(config, databaseState, { placesService }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
