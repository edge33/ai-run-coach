import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { beginSync, executeSync, loadConfig } from '@hub/core';
import { Store } from '@hub/db';
import { buildApp } from '../src/app.ts';

test('HTTP reads are local; schemas, origins, empty states and manual sync errors are enforced', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-api-'));
  const config = loadConfig({
    SQLITE_PATH: join(dir, 'db.sqlite'),
    APP_ORIGINS: 'http://localhost',
    SNAPSHOT_PATH: join(dir, 'snapshots'),
  });
  const store = new Store(config.databasePath);
  await store.migrate();
  const app = buildApp(store, config);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('Unexpected network');
  };
  try {
    const status = await app.inject({ url: '/api/status' });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().run_count, 0);
    const runs = await app.inject({ url: '/api/runs?start=2026-09-20&end=2026-09-21' });
    assert.equal(runs.statusCode, 200);
    assert.equal(runs.json().total, 0);
    assert.equal(
      (await app.inject({ url: '/api/runs?start=2026-02-30&end=2026-09-21' })).statusCode,
      400,
    );
    assert.equal(
      (await app.inject({ url: '/api/runs?start=2026-09-20&end=2026-09-21&limit=101' })).statusCode,
      400,
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
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/sync-runs', payload: { mode: 'scheduled' } }))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/sync-runs',
          payload: { mode: 'recent', unexpected: true },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/sync-runs', payload: { mode: 'recent' } }))
        .statusCode,
      503,
    );
    assert.equal(
      (await app.inject({ url: '/api/runs/00000000-0000-4000-8000-000000000000' })).statusCode,
      404,
    );
    assert.equal(calls, 0);
    const run = await beginSync(
      store,
      { mode: 'range', start: '2026-09-20', end: '2026-09-20' },
      config.timezone,
    );
    await executeSync(store, { ...config, apiKey: 'synthetic' }, run.id, {
      fetch: async () => Response.json([]),
    });
    const events = await app.inject({ url: `/api/sync-runs/${run.id}/events` });
    assert.equal(events.statusCode, 200);
    assert.match(events.body, /event: progress/);
    assert.match(events.body, /"status":"completed"/);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    await store.close();
    await rm(dir, { recursive: true });
  }
});
