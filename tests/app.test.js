import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { validate } from '../src/middleware/validate.js';
import { paginationSchema } from '../src/validators/pagination.js';
import { parseEnv } from '../src/config/env.js';

const config = { NODE_ENV: 'test', CLIENT_URL: 'http://localhost:5173' };
const app = (state = 1, options = {}) => createApp(config, { databaseState: () => state, logging: false, ...options });

test('health returns connected database and standard success response', async () => {
  const res = await request(app()).get('/api/v1/health').expect(200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.database, 'connected');
  assert.equal(res.body.data.status, 'ok');
  assert.equal(res.body.data.environment, 'test');
  assert.equal(typeof res.body.data.uptime, 'number');
  assert.ok(Number.isFinite(Date.parse(res.body.data.timestamp)));
  assert.equal(res.headers['cache-control'], 'no-store');
});
test('health returns 503 when MongoDB is unavailable', async () => {
  const res = await request(app(0)).get('/api/v1/health').expect(503);
  assert.deepEqual(res.body, { success: false, message: 'Database unavailable', errors: [] });
});
test('unknown route returns standard 404', async () => {
  const res = await request(app()).get('/missing').expect(404);
  assert.deepEqual(res.body, { success: false, message: 'Route not found', errors: [] });
});
test('removed Google Business Profile OAuth callback is no longer registered', async () => {
  await request(app()).get('/api/v1/google-business-profile/callback').expect(404);
});
test('Google reviews endpoint rejects invalid business IDs before database lookup', async () => {
  const res = await request(app()).get('/api/v1/businesses/not-an-id/google-reviews').expect(400);
  assert.equal(res.body.message, 'Invalid business ID');
});
test('Google reviews endpoint applies its configured per-client limit', async () => {
  const instance = createApp({ ...config, GOOGLE_PLACES_RATE_LIMIT_MAX: 1 }, { logging: false, rateLimitMax: 100 });
  await request(instance).get('/api/v1/businesses/not-an-id/google-reviews').expect(400);
  const limited = await request(instance).get('/api/v1/businesses/not-an-id/google-reviews').expect(429);
  assert.equal(limited.body.message, 'Google review request limit reached. Please try again later.');
});
test('malformed and oversized JSON use standard errors', async () => {
  for (const [body, status] of [['{', 400], [JSON.stringify({ data: 'x'.repeat(110000) }), 413]]) {
    const res = await request(app()).post('/api/v1/example').set('Content-Type', 'application/json').send(body).expect(status);
    assert.equal(res.body.success, false);
    assert.ok(Array.isArray(res.body.errors));
  }
});
test('security headers, CORS, proxy default and rate limiting', async () => {
  const instance = app(1, { rateLimitMax: 1 });
  assert.equal(instance.get('trust proxy'), false);
  const res = await request(instance).get('/api/v1/health').set('Origin', config.CLIENT_URL).expect(200);
  assert.equal(res.headers['access-control-allow-origin'], config.CLIENT_URL);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-powered-by'], undefined);
  const limited = await request(instance).get('/api/v1/health').expect(429);
  assert.equal(limited.body.success, false);
});
test('validation parses body, params and query without mutating Express query', async () => {
  const instance = express();
  instance.use(express.json());
  const schema = paginationSchema.extend({ body: z.object({ name: z.string().min(2) }), params: z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) }) });
  instance.post('/:id', validate(schema), (req, res) => res.json(req.validated));
  instance.use(errorHandler);
  const res = await request(instance).post('/0123456789abcdef01234567?page=2').send({ name: 'Shop' }).expect(200);
  assert.equal(res.body.query.page, 2);
  assert.equal(res.body.query.limit, 20);
  const invalid = await request(instance).post('/invalid?limit=101').send({ name: '' }).expect(400);
  assert.equal(invalid.body.errors.length, 3);
});
test('production masks internal errors, database values and stack traces', async () => {
  for (const [error, status] of [
    [new Error('mongodb://secret:password@internal'), 500],
    [Object.assign(new Error('secret'), { code: 11000, keyValue: { email: 'private@example.com' } }), 409],
    [Object.assign(new Error('secret'), { name: 'CastError' }), 400],
    [Object.assign(new Error('secret'), { name: 'ValidationError', errors: { name: { message: 'secret' } } }), 400],
  ]) {
    const instance = express();
    instance.set('env', 'production');
    instance.get('/', async () => { throw error; });
    instance.use(errorHandler);
    const res = await request(instance).get('/').expect(status);
    assert.equal(res.body.success, false);
    assert.ok(Array.isArray(res.body.errors));
    assert.doesNotMatch(JSON.stringify(res.body), /secret|password|private@example|stack/);
  }
});
test('environment rejects missing values, placeholders and shared secrets', () => {
  assert.throws(() => parseEnv({}), /Invalid environment configuration/);
  const env = { MONGODB_URI: 'mongodb://localhost/test', JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32), CLIENT_URL: config.CLIENT_URL };
  assert.equal(parseEnv(env).PORT, 5000);
  assert.equal(parseEnv(env).GOOGLE_PLACES_REVIEW_MODE, 'rating');
  assert.equal(parseEnv({ ...env, GOOGLE_PLACES_API_KEY: 'server-key', GOOGLE_PLACES_REVIEW_MODE: 'reviews' }).GOOGLE_PLACES_REVIEW_MODE, 'reviews');
  assert.throws(() => parseEnv({ ...env, GOOGLE_PLACES_REVIEW_MODE: 'all' }), /GOOGLE_PLACES_REVIEW_MODE/);
  assert.equal(parseEnv({ ...env, GOOGLE_CLIENT_ID: 'legacy-value' }).GOOGLE_CLIENT_ID, undefined);
  assert.throws(() => parseEnv({ ...env, JWT_REFRESH_SECRET: env.JWT_ACCESS_SECRET }), /must differ/);
  assert.throws(() => parseEnv({ ...env, PORT: 'no' }), /PORT/);
  assert.throws(() => parseEnv({ ...env, JWT_ACCESS_SECRET: 'replace-with-a-random-secret-at-least-32-characters' }), /placeholder/);
});
