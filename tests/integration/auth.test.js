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
import { RefreshToken } from '../../src/models/RefreshToken.js';

const config = { NODE_ENV: 'test', CLIENT_URL: 'http://localhost:5173', JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40), JWT_ACCESS_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '7d' };
test('isolated MongoDB: registration, login, rotation, logout and role boundary', { timeout: 120000 }, async () => {
  const mongo = await MongoMemoryServer.create();
  try {
    await connectDatabase(mongo.getUri('auth_integration'));
    await Promise.all([User.init(), RefreshToken.init()]);
    const placesService = { async verifyPlaceId(placeId) { return placeId === 'ChIJmismatch' ? 'mismatch' : 'verified'; } };
    const app = createApp(config, { logging: false, rateLimitMax: 1000, placesService });
    const registered = await request(app).post('/api/v1/auth/register').send({ email: 'owner@example.com', password: 'safe-password-123' }).expect(201);
    assert.equal(registered.body.data.user.role, 'business_owner');
    assert.equal(registered.body.data.user.passwordHash, undefined);
    const storedUser = await User.findOne({ email: 'owner@example.com' }).select('+passwordHash');
    assert.equal(storedUser.role, 'business_owner');
    assert.notEqual(storedUser.passwordHash, 'safe-password-123');
    const ownerToken = registered.body.data.accessToken;
    const category = await Category.create({ name: 'Bakery', slug: 'bakery' });
    const listing = {
      name: 'Example Bakery',
      description: 'Fresh bread and cakes every day.',
      category: String(category._id),
      services: ['Baking'],
      phone: '9876543210',
      email: 'owner@example.com',
      address: { addressLine1: '123 Main Street', city: 'Bengaluru', state: 'Karnataka' },
    };
    const createdWithoutId = await request(app).post('/api/v1/owner/businesses').set('Authorization', `Bearer ${ownerToken}`).send(listing).expect(201);
    assert.equal(createdWithoutId.body.data.item.googlePlaceVerificationStatus, 'unverified');
    const createdWithId = await request(app).post('/api/v1/owner/businesses').set('Authorization', `Bearer ${ownerToken}`).send({ ...listing, name: 'Example Bakery Two', googlePlaceId: 'ChIJabc' }).expect(201);
    assert.equal(createdWithId.body.data.item.googlePlaceId, 'ChIJabc');
    assert.equal(createdWithId.body.data.item.googlePlaceVerificationStatus, 'verified');
    const mismatched = await request(app).post('/api/v1/owner/businesses').set('Authorization', `Bearer ${ownerToken}`).send({ ...listing, name: 'Example Bakery Three', googlePlaceId: 'ChIJmismatch' }).expect(201);
    assert.equal(mismatched.body.data.item.googlePlaceVerificationStatus, 'mismatch');
    const admin = await User.create({ name: 'Admin', email: 'admin@example.com', role: 'admin' });
    const adminToken = jwt.sign({ sub: String(admin._id) }, config.JWT_ACCESS_SECRET, { expiresIn: '15m' });
    await request(app).patch(`/api/v1/admin/businesses/${mismatched.body.data.item._id}/review`).set('Authorization', `Bearer ${adminToken}`).send({ decision: 'approve' }).expect(422);
    const mismatchToClear = await request(app).post('/api/v1/owner/businesses').set('Authorization', `Bearer ${ownerToken}`).send({ ...listing, name: 'Example Bakery To Clear', googlePlaceId: 'ChIJmismatch' }).expect(201);
    const clearedMismatch = await request(app).patch(`/api/v1/admin/businesses/${mismatchToClear.body.data.item._id}/google-place`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    assert.equal(clearedMismatch.body.data.item.googlePlaceVerificationStatus, 'unverified');
    assert.equal(clearedMismatch.body.data.item.googlePlaceId, undefined);
    await request(app).patch(`/api/v1/admin/businesses/${mismatchToClear.body.data.item._id}/review`).set('Authorization', `Bearer ${adminToken}`).send({ decision: 'approve' }).expect(200);
    const rejectedListing = await request(app).patch(`/api/v1/admin/businesses/${mismatched.body.data.item._id}/review`).set('Authorization', `Bearer ${adminToken}`).send({ decision: 'reject', rejectionReason: 'Correct the Google Place ID.' });
    assert.equal(rejectedListing.status, 200, JSON.stringify(rejectedListing.body));
    const updatedPlaceId = await request(app).patch(`/api/v1/owner/businesses/${mismatched.body.data.item._id}`).set('Authorization', `Bearer ${ownerToken}`).send({ googlePlaceId: ' ChIJfixed ' }).expect(200);
    assert.equal(updatedPlaceId.body.data.item.googlePlaceId, 'ChIJfixed');
    assert.equal(updatedPlaceId.body.data.item.googlePlaceVerificationStatus, 'verified');
    const editableBusiness = await Business.findById(mismatched.body.data.item._id);
    editableBusiness.listingStatus = 'rejected';
    await editableBusiness.save();
    const removedPlaceId = await request(app).patch(`/api/v1/owner/businesses/${mismatched.body.data.item._id}`).set('Authorization', `Bearer ${ownerToken}`).send({ googlePlaceId: '' }).expect(200);
    assert.equal(removedPlaceId.body.data.item.googlePlaceId, undefined);
    assert.equal(removedPlaceId.body.data.item.googlePlaceVerificationStatus, 'unverified');
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'owner@example.com', password: 'safe-password-123' }).expect(200);
    const refreshed = await request(app).post('/api/v1/auth/refresh-token').send({ refreshToken: login.body.data.refreshToken }).expect(200);
    assert.notEqual(refreshed.body.data.refreshToken, login.body.data.refreshToken);
    await request(app).post('/api/v1/auth/refresh-token').send({ refreshToken: login.body.data.refreshToken }).expect(401);
    await request(app).post('/api/v1/auth/logout').send({ refreshToken: refreshed.body.data.refreshToken }).expect(200);
    await request(app).get('/api/v1/owner/businesses').set('Authorization', `Bearer ${registered.body.data.accessToken}`).expect(200);
  } finally { await disconnectDatabase(); await mongo.stop(); }
});
