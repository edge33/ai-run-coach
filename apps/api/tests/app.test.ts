import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { beginSync, executeSync, loadConfig, mapActivity, mapWellness } from '@hub/core';
import { Store } from '@hub/db';
import { buildApp } from '../src/app.ts';

test('HTTP reads are local; schemas, origins, empty states and manual sync errors are enforced', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-api-'));
  const config = loadConfig({
    SQLITE_PATH: join(dir, 'db.sqlite'),
    APP_ORIGINS: 'http://localhost',
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
    const mapped = mapActivity(
      {
        id: 'i123',
        type: 'Run',
        start_date_local: '2026-09-20T08:00:00',
        distance: 5000,
        icu_intervals: [{ type: 'WORK', elapsed_time: 1800 }],
      },
      true,
    );
    await store.saveRun(mapped.run, mapped.intervals);
    await store.saveWellness(mapWellness({ id: '2026-09-20', hrv: 42 }));
    const detail = await app.inject({ url: '/api/runs/i123' });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().run.id, 'i123');
    assert.equal(detail.json().intervals[0].sequence, 0);
    const health = await app.inject({ url: '/api/health?start=2026-09-20&end=2026-09-20' });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().items[0].hrv_ms, 42);
    assert.equal(health.json().items[0].source_json, undefined);
    assert.equal(
      (
        await app.inject({
          url: '/api/summaries/health?start=2026-09-20&end=2026-09-20&metric=hrv_sdnn',
        })
      ).statusCode,
      400,
    );
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

test('UI sync starts in the background, rejects competing imports, and publishes completion', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-api-sync-'));
  const config = loadConfig({
    SQLITE_PATH: join(dir, 'db.sqlite'),
    INTERVALS_API_KEY: 'synthetic',
    APP_ORIGINS: 'http://localhost',
  });

  const store = new Store(config.databasePath);
  await store.migrate();

  const app = buildApp(store, config);

  const originalFetch = globalThis.fetch;
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested: string[] = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    await blocked;

    if (url.includes('/activities?'))
      return Response.json([
        {
          id: 'i123',
          type: 'Run',
          start_date_local: '2026-09-20T08:00:00',
        },
      ]);

    if (url.includes('/activity/'))
      return Response.json({
        id: 'i123',
        type: 'Run',
        start_date_local: '2026-09-20T08:00:00',
        distance: 5000,
        icu_intervals: [],
      });

    return Response.json([{ id: '2026-09-20', hrv: 42 }]);
  };

  try {
    const payload = { mode: 'range', start: '2026-09-20', end: '2026-09-20' };
    const started = await app.inject({ method: 'POST', url: '/api/sync-runs', payload });
    assert.equal(started.statusCode, 202);
    const id = started.json().id;
    assert.equal(started.json().status, 'running');
    assert.equal((await app.inject({ url: '/api/status' })).json().active.id, id);

    const competing = await app.inject({ method: 'POST', url: '/api/sync-runs', payload });
    assert.equal(competing.statusCode, 409);
    assert.equal(competing.json().active.id, id);

    const events = app.inject({ url: `/api/sync-runs/${id}/events` });
    release();

    const completed = await events;

    assert.match(completed.body, /"status":"completed"/);
    assert.equal((await app.inject({ url: '/api/runs/i123' })).json().run.distance_m, 5000);
    assert.equal(
      (await app.inject({ url: '/api/health?start=2026-09-20&end=2026-09-20' })).json().items[0]
        .hrv_ms,
      42,
    );
    assert.equal(requested.length, 3);

    const details = (await app.inject({ url: `/api/sync-runs/${id}` })).json();
    assert.equal(details.run.status, 'completed');
    assert.deepEqual(details.issues, []);
    assert.equal(await store.activeSync(), null);
  } finally {
    release();
    await app.close();
    globalThis.fetch = originalFetch;
    await store.close();
    await rm(dir, { recursive: true });
  }
});

test('API shutdown cancels an upstream request, preserves data, and releases the sync lease', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-api-shutdown-'));
  const config = loadConfig({
    SQLITE_PATH: join(dir, 'db.sqlite'),
    INTERVALS_API_KEY: 'synthetic',
    APP_ORIGINS: 'http://localhost',
  });

  const store = new Store(config.databasePath);
  await store.migrate();
  await store.saveWellness(mapWellness({ id: '2026-09-20', hrv: 42 }));

  const app = buildApp(store, config);

  const originalFetch = globalThis.fetch;
  let fetching: () => void = () => {};
  const requested = new Promise<void>((resolve) => {
    fetching = resolve;
  });
  let aborted = false;

  globalThis.fetch = async (_input, options) => {
    const signal = options?.signal;
    assert.ok(signal);

    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          aborted = true;
          reject(signal.reason);
        },
        { once: true },
      );
      fetching();
    });
  };

  try {
    const started = await app.inject({
      method: 'POST',
      url: '/api/sync-runs',
      payload: { mode: 'range', start: '2026-09-20', end: '2026-09-20' },
    });
    assert.equal(started.statusCode, 202);
    await requested;
    await app.close();

    assert.equal(aborted, true);
    assert.equal((await store.syncRun(started.json().id))?.status, 'interrupted');
    assert.equal(
      (await store.listWellness({ start: '2026-09-20', end: '2026-09-20' }, 10, 0)).items[0].hrv_ms,
      42,
    );

    assert.equal(await store.acquireLease('next-sync'), true);
    await store.releaseLease('next-sync');
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
    await store.close();
    await rm(dir, { recursive: true });
  }
});
