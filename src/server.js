import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { parseEnv } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { createApp } from './app.js';
import './models/User.js';
import './models/Category.js';
import './models/Business.js';
import './models/Location.js';
import './models/RefreshToken.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
let server;
let stopping = false;

async function shutdown(reason, code = 0) {
  if (stopping) return;
  stopping = true;
  console.info(`Shutting down: ${reason}`);
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  try {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await disconnectDatabase();
    clearTimeout(deadline);
    process.exitCode = code;
  } catch {
    console.error('Graceful shutdown failed');
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', () => void shutdown('unhandled rejection', 1));
process.on('uncaughtException', () => void shutdown('uncaught exception', 1));

try {
  let config;
  try { config = parseEnv(); } catch (error) { console.error(error.message); throw error; }
  await connectDatabase(config.MONGODB_URI, { production: config.NODE_ENV === 'production' });
  if (!stopping) {
    server = createApp(config).listen(config.PORT, () => console.info(`Lokal Lens API listening on port ${config.PORT}`));
    server.on('error', () => void shutdown('HTTP server failure', 1));
  } else {
    await disconnectDatabase();
  }
} catch {
  console.error('Server startup failed. Check environment configuration and MongoDB availability.');
  await shutdown('startup failure', 1);
}
