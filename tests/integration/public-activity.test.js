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
import { Lead } from '../../src/models/Lead.js';

const config = { NODE_ENV: 'test', CLIENT_URL: 'http://localhost:5173', JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40), JWT_ACCESS_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '7d' };

test('public business views and inquiries persist and appear in owner data', { timeout: 120000 }, async () => {
  const mongo = await MongoMemoryServer.create();
  try {
    await connectDatabase(mongo.getUri('public_activity'));
    const [owner, category] = await Promise.all([
      User.create({ name: 'Business Owner', email: 'owner@example.com', role: 'business_owner' }),
      Category.create({ name: 'Services', slug: 'services' }),
    ]);
    const business = await Business.create({
      owner: owner._id,
      name: 'Example Services',
      slug: 'example-services',
      category: category._id,
      services: ['Consultation'],
      listingStatus: 'published',
      verificationStatus: 'verified',
      description: 'Helpful services for local customers.',
      phone: '9876543210',
      address: { addressLine1: '123 Main Street', city: 'Bengaluru', state: 'Karnataka' },
    });
    const app = createApp(config, { logging: false, rateLimitMax: 1000 });
    const ownerToken = jwt.sign({ sub: String(owner._id) }, config.JWT_ACCESS_SECRET, { expiresIn: '15m' });

    await request(app).post(`/api/v1/businesses/${business._id}/views`).expect(200);
    await request(app).post(`/api/v1/businesses/${business._id}/views`).expect(200);
    const inquiry = await request(app).post(`/api/v1/businesses/${business._id}/leads`).send({
      name: 'Jamie Customer',
      phone: '+1 (415) 555-0134',
      email: 'jamie@example.com',
      service: 'Consultation',
      message: 'I would like to know more about your service.',
    }).expect(201);
    assert.equal(inquiry.body.data.item.leadCount, 1);
    assert.equal(await Lead.countDocuments({ business: business._id }), 1);

    const publicListing = await request(app).get('/api/v1/businesses/example-services').expect(200);
    assert.equal(publicListing.body.data.item.viewCount, 2);
    assert.equal(publicListing.body.data.item.leadCount, 1);

    const ownerListing = await request(app).get('/api/v1/owner/businesses?limit=100').set('Authorization', `Bearer ${ownerToken}`).expect(200);
    assert.equal(ownerListing.body.data.items[0].leadCount, 1);
    const ownerLeads = await request(app).get('/api/v1/owner/leads?limit=100').set('Authorization', `Bearer ${ownerToken}`).expect(200);
    assert.equal(ownerLeads.body.data.items.length, 1);
    assert.equal(ownerLeads.body.data.items[0].name, 'Jamie Customer');
    assert.equal(ownerLeads.body.data.items[0].business.name, 'Example Services');
    assert.equal(ownerLeads.body.data.items[0].phone, '+14155550134');
    await request(app).patch(`/api/v1/owner/leads/${ownerLeads.body.data.items[0]._id}`).set('Authorization', `Bearer ${ownerToken}`).send({ status: 'contacted' }).expect(200);
    const note = await request(app).post(`/api/v1/owner/leads/${ownerLeads.body.data.items[0]._id}/notes`).set('Authorization', `Bearer ${ownerToken}`).send({ note: 'Called the customer.' }).expect(200);
    assert.equal(note.body.data.item.notes[0], 'Called the customer.');
    assert.equal((await Lead.findById(ownerLeads.body.data.items[0]._id)).status, 'contacted');

    await request(app).post(`/api/v1/businesses/${business._id}/leads`).send({
      name: 'A',
      phone: '123',
      message: 'No',
    }).expect(400);
    await request(app).get('/api/v1/owner/leads?limit=100').expect(401);
  } finally { await disconnectDatabase(); await mongo.stop(); }
});
