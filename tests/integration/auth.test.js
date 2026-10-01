import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { RefreshToken } from '../../src/models/RefreshToken.js';

const config = { NODE_ENV: 'test', CLIENT_URL: 'http://localhost:5173', JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40), JWT_ACCESS_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '7d' };
test('isolated MongoDB: registration, login, rotation, logout and role boundary', { timeout: 120000 }, async () => {
  const mongo = await MongoMemoryServer.create();
  try {
    await connectDatabase(mongo.getUri('auth_integration'));
    await Promise.all([User.init(), RefreshToken.init()]);
    const app = createApp(config, { logging: false, rateLimitMax: 1000 });
    const registered = await request(app).post('/api/v1/auth/register').send({ email: 'owner@example.com', password: 'safe-password-123' }).expect(201);
    assert.equal(registered.body.data.user.role, 'business_owner');
    assert.equal(registered.body.data.user.passwordHash, undefined);
    const storedUser = await User.findOne({ email: 'owner@example.com' }).select('+passwordHash');
    assert.equal(storedUser.role, 'business_owner');
    assert.notEqual(storedUser.passwordHash, 'safe-password-123');
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'owner@example.com', password: 'safe-password-123' }).expect(200);
    const refreshed = await request(app).post('/api/v1/auth/refresh-token').send({ refreshToken: login.body.data.refreshToken }).expect(200);
    assert.notEqual(refreshed.body.data.refreshToken, login.body.data.refreshToken);
    await request(app).post('/api/v1/auth/refresh-token').send({ refreshToken: login.body.data.refreshToken }).expect(401);
    await request(app).post('/api/v1/auth/logout').send({ refreshToken: refreshed.body.data.refreshToken }).expect(200);
    await request(app).get('/api/v1/owner/businesses').set('Authorization', `Bearer ${registered.body.data.accessToken}`).expect(200);
  } finally { await disconnectDatabase(); await mongo.stop(); }
});
