import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { createApp } from '../../src/app.js';
import { User } from '../../src/models/User.js';
import { Category } from '../../src/models/Category.js';
import { Business } from '../../src/models/Business.js';

const config = { NODE_ENV: 'test', CLIENT_URL: 'http://localhost:5173', JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40), JWT_ACCESS_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '7d' };
const accessToken = userId => jwt.sign({ sub: String(userId) }, config.JWT_ACCESS_SECRET, { expiresIn: '15m' });

test('admin business CSV import creates valid draft rows and reports invalid rows', { timeout: 120000 }, async () => {
  const mongo = await MongoMemoryServer.create();
  try {
    await connectDatabase(mongo.getUri('admin_business_import'));
    const [admin, owner, category] = await Promise.all([
      User.create({ name: 'Admin User', email: 'admin@example.com', role: 'admin' }),
      User.create({ name: 'Business Owner', email: 'owner@example.com', role: 'business_owner' }),
      Category.create({ name: 'Food & Drink', slug: 'food-drink' }),
    ]);
    const app = createApp(config, { logging: false, rateLimitMax: 1000 });
    const csv = [
      'name,ownerEmail,category,description,services,phone,email,addressLine1,city,state,mondayHours',
      '"Bakery, Downtown",owner@example.com,Food & Drink,"Bread, cakes","Baking|Catering",9876543210,bakery@example.com,123 Main Street,Bengaluru,Karnataka,09:00-17:00',
      'Second Bakery,owner@example.com,Missing Category,Fresh bread,Baking,9876543211,second@example.com,456 Main Street,Bengaluru,Karnataka,',
    ].join('\r\n');
    const response = await request(app)
      .post('/api/v1/admin/businesses/import')
      .set('Authorization', `Bearer ${accessToken(admin._id)}`)
      .attach('file', Buffer.from(csv), { filename: 'businesses.csv', contentType: 'text/csv' })
      .expect(200);

    assert.equal(response.body.data.createdCount, 1);
    assert.equal(response.body.data.failedCount, 1);
    assert.equal(response.body.data.failed[0].row, 3);
    assert.match(response.body.data.failed[0].message, /Missing Category/);
    assert.equal(response.body.data.items[0].name, 'Bakery, Downtown');
    assert.equal(response.body.data.items[0].owner._id, String(owner._id));
    assert.equal(response.body.data.items[0].category._id, String(category._id));
    assert.equal(response.body.data.items[0].listingStatus, 'draft');
    assert.deepEqual(response.body.data.items[0].services, ['Baking', 'Catering']);
    assert.equal(response.body.data.items[0].workingHours[0].opens, '09:00');
    assert.equal(await Business.countDocuments(), 1);

    await request(app)
      .post('/api/v1/admin/businesses/import')
      .set('Authorization', `Bearer ${accessToken(owner._id)}`)
      .attach('file', Buffer.from(csv), { filename: 'businesses.csv', contentType: 'text/csv' })
      .expect(403);
  } finally { await disconnectDatabase(); await mongo.stop(); }
});
