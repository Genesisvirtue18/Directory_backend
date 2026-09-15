import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const entry = fileURLToPath(new URL('../src/server.js', import.meta.url));
const base = {
  ...process.env, NODE_ENV: 'test', PORT: '5000', CLIENT_URL: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32), TRUST_PROXY: '',
};

test('startup rejects missing configuration before opening HTTP listener', async () => {
  await assert.rejects(execute(process.execPath, [entry], {
    env: { ...base, MONGODB_URI: '' }, timeout: 20000,
  }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /MONGODB_URI/);
    assert.doesNotMatch(error.stdout, /listening on port/);
    return true;
  });
});

test('initial database failure exits nonzero and never logs URI credentials', async () => {
  await assert.rejects(execute(process.execPath, [entry], {
    // Local closed port only: this cannot reach a configured or production database.
    env: { ...base, MONGODB_URI: 'mongodb://fixture-user:fixture-password@127.0.0.1:1/unavailable' },
    timeout: 20000,
  }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Server startup failed/);
    assert.doesNotMatch(error.stdout + error.stderr, /fixture-user|fixture-password|listening on port/);
    return true;
  });
});
