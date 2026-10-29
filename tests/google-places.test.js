import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createGoogleReviewsController } from '../src/controllers/googlePlacesController.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { ownerBusinessBody } from '../src/routes/index.js';
import { createGooglePlacesService, GooglePlacesError, placeMatchesBusiness, safeGooglePlacesError } from '../src/services/googlePlaces.js';

const successfulResponse = value => ({ ok: true, status: 200, json: async () => value });
const failedResponse = (status, body) => ({ ok: false, status, json: async () => body });
const validPlace = {
  displayName: { text: 'Example Bakery' },
  formattedAddress: '123 Main Street, Bengaluru, Karnataka 560001, India',
};
const validBusiness = {
  name: 'Example Bakery',
  address: { addressLine1: '123 Main Street', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001' },
};

test('Place Details rating mode uses the rating field mask and caches responses', async () => {
  const calls = [];
  const service = createGooglePlacesService({ GOOGLE_PLACES_API_KEY: 'test-key', GOOGLE_PLACES_REVIEW_MODE: 'rating' }, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return successfulResponse({ rating: 4.7, userRatingCount: 85, googleMapsUri: 'https://maps.google.com/?cid=123' });
    },
    logger: { info() {} },
  });

  const first = await service.getReviewDetails(' ChIJabc ');
  const second = await service.getReviewDetails('ChIJabc');
  assert.equal(first.mode, 'rating');
  assert.deepEqual(first.place, second.place);
  assert.doesNotMatch(JSON.stringify(first), /test-key/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers['X-Goog-Api-Key'], 'test-key');
  assert.equal(calls[0].options.headers['X-Goog-FieldMask'], 'rating,userRatingCount,googleMapsUri');
  assert.match(calls[0].url, /places\/ChIJabc$/);
});

test('Place Details reviews mode requests only rating, count, Maps link and review fields', async () => {
  let options;
  const service = createGooglePlacesService({ GOOGLE_PLACES_API_KEY: 'test-key', GOOGLE_PLACES_REVIEW_MODE: 'reviews' }, {
    fetchImpl: async (_url, requestOptions) => {
      options = requestOptions;
      return successfulResponse({ reviews: [{ text: { text: 'Great service' } }] });
    },
    logger: { info() {} },
  });
  const result = await service.getReviewDetails('ChIJabc');
  assert.equal(result.mode, 'reviews');
  assert.equal(options.headers['X-Goog-FieldMask'], 'rating,userRatingCount,googleMapsUri,reviews');
  assert.equal(result.place.reviews[0].text.text, 'Great service');
});

test('request coalescing shares a concurrent Place Details request', async () => {
  let calls = 0;
  let resolveResponse;
  const service = createGooglePlacesService({ GOOGLE_PLACES_API_KEY: 'test-key' }, {
    fetchImpl: () => { calls += 1; return new Promise(resolve => { resolveResponse = resolve; }); },
    logger: { info() {} },
  });
  const first = service.getReviewDetails('ChIJabc');
  const second = service.getReviewDetails('ChIJabc');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  resolveResponse(successfulResponse({ rating: 4 }));
  assert.deepEqual(await first, await second);
});

test('short cache expires and refreshes the Place Details result', async () => {
  let timestamp = 10;
  let calls = 0;
  const service = createGooglePlacesService({ GOOGLE_PLACES_API_KEY: 'test-key' }, {
    now: () => timestamp,
    cacheTtlMs: 20,
    fetchImpl: async () => successfulResponse({ rating: ++calls }),
    logger: { info() {} },
  });
  await service.getReviewDetails('ChIJabc');
  timestamp = 31;
  await service.getReviewDetails('ChIJabc');
  assert.equal(calls, 2);
});

test('Place ID verification compares both business name and address', () => {
  assert.equal(placeMatchesBusiness(validPlace, validBusiness), true);
  assert.equal(placeMatchesBusiness({ ...validPlace, displayName: { text: 'Different Company' } }, validBusiness), false);
  assert.equal(placeMatchesBusiness({ ...validPlace, formattedAddress: '88 Other Road, Mumbai, Maharashtra' }, validBusiness), false);
  assert.equal(placeMatchesBusiness({ displayName: { text: 'Example Bakery' } }, validBusiness), false);
});

test('owner updates revalidate Place IDs against fresh provider details', async () => {
  let calls = 0;
  const service = createGooglePlacesService({ GOOGLE_PLACES_API_KEY: 'test-key' }, {
    fetchImpl: async () => { calls += 1; return successfulResponse(validPlace); },
    logger: { info() {} },
  });
  assert.equal(await service.verifyPlaceId('ChIJabc', validBusiness), 'verified');
  assert.equal(await service.verifyPlaceId('ChIJabc', validBusiness), 'verified');
  assert.equal(calls, 2);
});

test('owner Place ID input is optional, whitespace-normalized and rejects Maps URLs', () => {
  const placeId = ownerBusinessBody.shape.googlePlaceId;
  assert.equal(placeId.parse(undefined), undefined);
  assert.equal(placeId.parse('  ChIJ  abc  '), 'ChIJabc');
  assert.equal(placeId.parse('   '), '');
  assert.equal(placeId.safeParse('https://maps.google.com/?q=business').success, false);
  assert.equal(placeId.safeParse('a'.repeat(301)).success, false);
});

test('invalid Place IDs and missing API keys fail before making a provider request', async () => {
  let calls = 0;
  const service = createGooglePlacesService({ GOOGLE_PLACES_API_KEY: '' }, {
    fetchImpl: async () => { calls += 1; return successfulResponse({}); },
    logger: { info() {} },
  });
  await assert.rejects(service.getReviewDetails('bad/id'), error => error.code === 'PLACES_INVALID_ID');
  await assert.rejects(service.getReviewDetails('ChIJabc'), error => error.code === 'PLACES_NOT_CONFIGURED');
  assert.equal(calls, 0);
});

test('provider quota, billing and invalid Place ID errors are classified without retries', async () => {
  for (const [status, body, expectedCode] of [
    [429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }, 'PLACES_RATE_LIMITED'],
    [403, { error: { status: 'PERMISSION_DENIED', message: 'Billing account is disabled' } }, 'PLACES_BILLING_DISABLED'],
    [403, { error: { status: 'PERMISSION_DENIED', message: 'API key is not authorized' } }, 'PLACES_FORBIDDEN'],
    [400, { error: { status: 'INVALID_ARGUMENT', message: 'Invalid place id' } }, 'PLACES_INVALID_ID'],
  ]) {
    let calls = 0;
    const service = createGooglePlacesService({ GOOGLE_PLACES_API_KEY: 'test-key' }, {
      fetchImpl: async () => { calls += 1; return failedResponse(status, body); },
      logger: { info() {} },
    });
    await assert.rejects(service.getReviewDetails('ChIJabc'), error => error.code === expectedCode);
    assert.equal(calls, 1);
  }
  assert.deepEqual(safeGooglePlacesError(new GooglePlacesError('PLACES_RATE_LIMITED', 429)), [503, 'Google Places request limit reached. Please try again later.']);
});

test('network failures are mapped safely and are not retried', async () => {
  let calls = 0;
  const logs = [];
  const service = createGooglePlacesService({ GOOGLE_PLACES_API_KEY: 'test-key' }, {
    fetchImpl: async () => { calls += 1; throw new Error('network failed'); },
    logger: { info: (...args) => logs.push(args) },
  });
  await assert.rejects(service.getReviewDetails('ChIJabc'), error => error.code === 'PLACES_NETWORK');
  assert.equal(calls, 1);
  assert.deepEqual(safeGooglePlacesError(new GooglePlacesError('PLACES_NETWORK', 503)), [503, 'Google Places is temporarily unreachable. Please try again later.']);
  assert.doesNotMatch(JSON.stringify(logs), /test-key/);
});

test('Google reviews endpoint returns consistent no-place, unverified, successful and empty-review states', async () => {
  const service = {
    async getReviewDetails() {
      return {
        mode: 'reviews',
        place: {
          rating: 4.5,
          userRatingCount: 20,
          googleMapsUri: 'https://maps.google.com/?cid=123',
          reviews: [{
            rating: 5,
            text: { text: 'Excellent' },
            relativePublishTimeDescription: 'a month ago',
            authorAttribution: { displayName: 'Reviewer', uri: 'https://www.google.com/maps/contrib/123' },
          }],
        },
      };
    },
  };
  const businesses = new Map([
    ['000000000000000000000001', { googlePlaceVerificationStatus: 'unverified', googlePlaceId: 'ChIJabc' }],
    ['000000000000000000000002', { googlePlaceVerificationStatus: 'verified', googlePlaceId: 'ChIJabc' }],
    ['000000000000000000000003', { googlePlaceVerificationStatus: 'verified' }],
  ]);
  const app = express();
  app.get('/:id', createGoogleReviewsController(service, async id => businesses.get(id)));
  app.use(errorHandler);

  const missingPlace = await request(app).get('/000000000000000000000003').expect(200);
  assert.equal(missingPlace.body.data.google.status, 'no_place_id');
  const unverified = await request(app).get('/000000000000000000000001').expect(200);
  assert.equal(unverified.body.data.google.status, 'unverified');
  const reviews = await request(app).get('/000000000000000000000002').expect(200);
  assert.equal(reviews.body.data.google.rating, 4.5);
  assert.equal(reviews.body.data.google.reviews[0].text, 'Excellent');
  assert.equal(reviews.body.data.google.reviews[0].author.uri, 'https://www.google.com/maps/contrib/123');
  assert.equal(reviews.body.data.google.mapsUri, 'https://maps.google.com/?cid=123');
});

test('Google reviews endpoint reports no review text without inventing entries', async () => {
  const controller = createGoogleReviewsController({
    async getReviewDetails() { return { mode: 'reviews', place: { rating: 4, userRatingCount: 2, reviews: [] } }; },
  }, async () => ({ googlePlaceId: 'ChIJabc', googlePlaceVerificationStatus: 'verified' }));
  const app = express();
  app.get('/:id', controller);
  app.use(errorHandler);
  const response = await request(app).get('/000000000000000000000002').expect(200);
  assert.equal(response.body.data.google.reviews.length, 0);
  assert.equal(response.body.data.google.available, true);
  assert.equal(response.body.data.google.status, 'available');
  assert.equal(response.body.data.google.reviewsStatus, 'no_reviews');
  assert.equal(response.body.data.google.mapsUri, 'https://www.google.com/maps/search/?api=1&query=place_id%3AChIJabc');
});

test('empty Google review states reflect the configured reviews mode', async () => {
  const controller = createGoogleReviewsController({ reviewMode: 'reviews', async getReviewDetails() { throw new Error('Should not call Google for an unlinked business'); } }, async () => ({}));
  const app = express();
  app.get('/:id', controller);
  app.use(errorHandler);
  const response = await request(app).get('/000000000000000000000002').expect(200);
  assert.equal(response.body.data.google.mode, 'reviews');
  assert.equal(response.body.data.google.reviewsStatus, 'unavailable');
});
