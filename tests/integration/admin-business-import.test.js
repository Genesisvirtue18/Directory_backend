import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

test('admin business CSV import submits valid rows for review and reports invalid rows', { timeout: 120000 }, async () => {
  const mongo = await MongoMemoryServer.create();
  try {
    await connectDatabase(mongo.getUri('admin_business_import'));
    const [admin, owner, category] = await Promise.all([
      User.create({ name: 'Admin User', email: 'admin@example.com', role: 'admin' }),
      User.create({ name: 'Business Owner', email: 'owner@example.com', role: 'business_owner' }),
      Category.create({ name: 'Food & Drink', slug: 'food-drink' }),
      User.create({ name: 'Demo Business Owner', email: 'demo.owner@example.com', role: 'business_owner' }),
      ...[
        ['Cafes & Restaurants', 'cafes-restaurants'],
        ['Healthcare', 'healthcare'],
        ['Home Services', 'home-services'],
        ['Beauty & Wellness', 'beauty-wellness'],
        ['Professional Services', 'professional-services'],
      ].map(([name, slug]) => Category.create({ name, slug })),
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
    assert.equal(response.body.data.items[0].listingStatus, 'pending_review');
    assert.deepEqual(response.body.data.items[0].services, ['Baking', 'Catering']);
    assert.equal(response.body.data.items[0].workingHours[0].opens, '09:00');
    assert.equal(await Business.countDocuments(), 1);

    const testCsv = await readFile(new URL('../../../Client/public/business-upload-test-5.csv', import.meta.url));
    const testResponse = await request(app)
      .post('/api/v1/admin/businesses/import')
      .set('Authorization', `Bearer ${accessToken(admin._id)}`)
      .attach('file', testCsv, { filename: 'business-upload-test-5.csv', contentType: 'text/csv' })
      .expect(200);
    assert.equal(testResponse.body.data.createdCount, 5, JSON.stringify(testResponse.body.data.failed));
    assert.equal(testResponse.body.data.failedCount, 0);
    assert.equal(testResponse.body.data.items.length, 5);
    assert.ok(testResponse.body.data.items.every(item => item.listingStatus === 'pending_review'));
    assert.equal(testResponse.body.data.items[0].establishedYear, 2020);
    assert.equal(testResponse.body.data.items[0].responseTimeMinutes, 15);
    assert.equal(testResponse.body.data.items[0].faqs[0].question, 'Do you have Wi-Fi?');
    assert.equal(testResponse.body.data.items[0].offers[0].code, 'BEAN5');
    assert.equal(testResponse.body.data.items[0].socialLinks.instagram, 'https://instagram.com/example');
    assert.equal(await Business.countDocuments(), 6);

    await request(app)
      .post('/api/v1/admin/businesses/import')
      .set('Authorization', `Bearer ${accessToken(owner._id)}`)
      .attach('file', Buffer.from(csv), { filename: 'businesses.csv', contentType: 'text/csv' })
      .expect(403);
  } finally { await disconnectDatabase(); await mongo.stop(); }
});
