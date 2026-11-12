import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '@hub/core';
import { buildApp } from '../src/app.ts';

test('API shell reports unavailable data and does not expose removed data/import routes', async () => {
  const app = buildApp(loadConfig({ APP_ORIGINS: 'http://localhost' }));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('Unexpected upstream request');
  };
  try {
    assert.equal((await app.inject('/healthz')).statusCode, 200);
    const status = await app.inject('/api/status');
    assert.equal(status.statusCode, 200);
    assert.deepEqual(status.json(), { data_available: false });
    for (const url of [
      '/api/runs',
      '/api/runs/123',
      '/api/runs/123/samples',
      '/api/health',
      '/api/summaries/runs',
      '/api/sync-runs',
    ]) {
      assert.equal((await app.inject(url)).statusCode, 404);
    }
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/sync-runs', payload: {} })).statusCode,
      404,
    );
    assert.equal(
      (await app.inject({ url: '/api/status', headers: { origin: 'http://evil.example' } }))
        .statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ url: '/api/status', headers: { host: 'evil.example' } })).statusCode,
      403,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});
