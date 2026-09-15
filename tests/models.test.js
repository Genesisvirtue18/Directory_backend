import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { Category } from '../src/models/Category.js';
import { Business } from '../src/models/Business.js';

test('User requires contact, normalizes email and has safe defaults', async () => {
  await assert.rejects(new User({ name: 'Test' }).validate());
  const user = new User({ name: 'Test', email: ' TEST@Example.com ' });
  await user.validate();
  assert.equal(user.email, 'test@example.com');
  assert.equal(user.role, 'customer');
  assert.equal(user.status, 'active');
  assert.equal(user.emailVerified, false);
  assert.equal(user.phoneVerified, false);
  await new User({ name: 'Test', phone: '+919876543210', email: ' ' }).validate();
  await assert.rejects(new User({ name: 'Test', email: 'invalid' }).validate());
  await assert.rejects(new User({ name: 'Test', phone: 'abc' }).validate());
});
test('User rejects plaintext passwordHash and hides hashes from serialization', async () => {
  await assert.rejects(new User({ name: 'Test', email: 'test@example.com', passwordHash: 'plaintext' }).validate());
  const user = new User({ name: 'Test', email: 'test@example.com', passwordHash: '$2b$12$' + 'a'.repeat(53) });
  await user.validate();
  assert.equal(user.toJSON().passwordHash, undefined);
  assert.equal(user.toObject().passwordHash, undefined);
  assert.equal(User.schema.path('passwordHash').options.select, false);
});
test('Category requires name and slug and supports parent references', async () => {
  await assert.rejects(new Category({}).validate());
  const category = new Category({ name: 'Dining', slug: ' DINING ', parentCategory: new mongoose.Types.ObjectId() });
  await category.validate();
  assert.equal(category.slug, 'dining');
  assert.equal(category.isActive, true);
  await assert.rejects(new Category({ name: 'Dining', slug: 'bad slug' }).validate());
});
const validBusiness = () => ({ owner: new mongoose.Types.ObjectId(), name: 'Sample Shop', slug: 'sample-shop', category: new mongoose.Types.ObjectId() });
test('Business required references, draft defaults and valid GeoJSON', async () => {
  await assert.rejects(new Business({}).validate());
  const business = new Business({ ...validBusiness(), location: { coordinates: [77.59, 12.97] } });
  await business.validate();
  assert.equal(business.location.type, 'Point');
  assert.equal(business.listingStatus, 'draft');
  assert.equal(business.verificationStatus, 'pending');
  assert.equal(business.averageRating, 0);
  await new Business(validBusiness()).validate();
  for (const coordinates of [[181, 0], [0, 91], [0], [0, 0, 0], []]) {
    await assert.rejects(new Business({ ...validBusiness(), location: { coordinates } }).validate());
  }
});
test('Business rejects invalid statuses, counters, ratings and opening hours', async () => {
  for (const fields of [{ listingStatus: 'live' }, { verificationStatus: 'yes' }, { averageRating: 6 }, { reviewCount: -1 }, { viewCount: 1.5 }, { owner: 'invalid' }, { workingHours: [{ day: 'monday', opens: '25:00', closes: '18:00' }] }]) {
    await assert.rejects(new Business({ ...validBusiness(), ...fields }).validate());
  }
});
test('model indexes include unique contacts/slugs, search fields and GeoJSON', () => {
  for (const model of [User, Category, Business]) {
    assert.equal(model.schema.options.timestamps, true);
    const indexes = model.schema.indexes();
    assert.equal(new Set(indexes.map(([keys]) => JSON.stringify(keys))).size, indexes.length);
  }
  assert.ok(User.schema.indexes().every(([, options]) => options.unique && options.partialFilterExpression));
  assert.ok(Category.schema.indexes().some(([keys, options]) => keys.slug && options.unique));
  assert.ok(Business.schema.indexes().some(([keys]) => keys.location === '2dsphere'));
});
