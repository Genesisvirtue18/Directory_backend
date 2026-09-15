import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Category } from '../../src/models/Category.js';
import { Business } from '../../src/models/Business.js';

test('isolated MongoDB: connection, indexes, uniqueness, hash projection and health', { timeout: 120000 }, async () => {
  // Never read MONGODB_URI: only this newly-created disposable database is used.
  const mongo = await MongoMemoryServer.create();
  try {
    await connectDatabase(mongo.getUri('day1_integration'));
    await Promise.all([User.init(), Category.init(), Business.init()]);
    const owner = await User.create({ name: 'Owner', email: ' OWNER@example.com ', passwordHash: '$2b$12$' + 'a'.repeat(53) });
    await User.create({ name: 'Phone One', phone: '+919876543210' });
    await User.create({ name: 'Phone Two', phone: '+919876543211' });
    await User.create({ name: 'Email Two', email: 'two@example.com' });
    await assert.rejects(User.create({ name: 'Duplicate', email: 'owner@example.com' }), { code: 11000 });
    await assert.rejects(User.create({ name: 'Duplicate', phone: '+919876543210' }), { code: 11000 });
    assert.equal((await User.findById(owner._id)).passwordHash, undefined);
    assert.ok((await User.findById(owner._id).select('+passwordHash')).passwordHash);
    const category = await Category.create({ name: 'Dining', slug: 'dining' });
    await assert.rejects(Category.create({ name: 'Dining Two', slug: 'dining' }), { code: 11000 });
    await Business.create({ owner: owner._id, category: category._id, name: 'Cafe', slug: 'cafe', location: { coordinates: [77.59, 12.97] } });
    await Business.create({ owner: owner._id, category: category._id, name: 'Draft', slug: 'draft' });
    await assert.rejects(Business.create({ owner: owner._id, category: category._id, name: 'Duplicate Cafe', slug: 'cafe' }), { code: 11000 });
    assert.equal(await Business.countDocuments({ location: { $geoWithin: { $centerSphere: [[77.59, 12.97], 1 / 6378.1] } } }), 1);
    const app = createApp({ NODE_ENV: 'test', CLIENT_URL: 'http://localhost:5173' }, { logging: false });
    await request(app).get('/api/v1/health').expect(200);
    await disconnectDatabase();
    await request(app).get('/api/v1/health').expect(503);
    assert.equal(mongoose.connection.readyState, 0);
  } finally {
    await disconnectDatabase();
    await mongo.stop();
  }
});
