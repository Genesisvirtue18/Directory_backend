import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decryptRefreshToken, encryptRefreshToken, googleFetch, hashState, listAllPages, safeGoogleError, stateToken } from '../src/services/googleBusinessProfile.js';

const config = { GOOGLE_TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32) };

test('Google refresh tokens encrypt and decrypt with authenticated AES-GCM', () => {
  const encrypted = encryptRefreshToken('refresh-secret-value', config);
  assert.notEqual(encrypted, 'refresh-secret-value');
  assert.equal(decryptRefreshToken(encrypted, config), 'refresh-secret-value');
  assert.throws(() => decryptRefreshToken(encrypted, { GOOGLE_TOKEN_ENCRYPTION_KEY: 'cd'.repeat(32) }));
});

test('OAuth state is unpredictable and stored as a one-way hash', () => {
  const first = stateToken(); const second = stateToken();
  assert.notEqual(first, second);
  assert.notEqual(hashState(first), first);
  assert.equal(hashState(first).length, 64);
});

test('Google list pagination is bounded and follows nextPageToken', async () => {
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    const target = new URL(url);
    return { ok: true, json: async () => target.searchParams.has('pageToken') ? { locations: [{ name: 'second' }] } : { locations: [{ name: 'first' }], nextPageToken: 'next' } };
  };
  try {
    assert.deepEqual(await listAllPages('https://example.test/locations', 'token', 'locations'), [{ name: 'first' }, { name: 'second' }]);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('Google API failures map to non-sensitive messages', () => {
  assert.deepEqual(safeGoogleError(new Error('GOOGLE_REAUTH')), [401, 'Google access expired. Reconnect your Business Profile.']);
  assert.doesNotMatch(safeGoogleError(new Error('private token response'))[1], /private|token response/);
});

test('Google Business Profile API-disabled response gets actionable guidance', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    json: async () => ({
      error: {
        status: 'PERMISSION_DENIED',
        details: [{ metadata: { reason: 'SERVICE_DISABLED' } }],
      },
    }),
  });
  try {
    await assert.rejects(googleFetch('https://example.test/locations', 'access-token'), error => {
      assert.equal(error.message, 'GOOGLE_API_DISABLED');
      assert.equal(error.googleApi, 'example.test');
      assert.deepEqual(safeGoogleError(error), [
        503,
        'Google Business Profile API access is not enabled for this project. Confirm Google has approved API access and enable the Account Management and Business Information APIs in Google Cloud.',
      ]);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Google scope and quota errors are reported distinctly', async () => {
  const originalFetch = globalThis.fetch;
  const failures = [
    { status: 403, reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', expected: 'GOOGLE_SCOPE' },
    { status: 429, reason: 'RATE_LIMIT_EXCEEDED', expected: 'GOOGLE_RATE_LIMITED' },
  ];
  try {
    for (const failure of failures) {
      globalThis.fetch = async () => ({
        ok: false,
        status: failure.status,
        json: async () => ({ error: { errors: [{ reason: failure.reason }] } }),
      });
      await assert.rejects(googleFetch('https://example.test/locations', 'access-token'), error => {
        assert.equal(error.message, failure.expected);
        assert.equal(error.googleApi, 'example.test');
        assert.ok(safeGoogleError(error)[1].length > 0);
        return true;
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
