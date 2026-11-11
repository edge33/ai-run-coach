import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { addDays } from '@hub/contracts';
import { beginSync, loadConfig, mapActivity, mapRunStreams, mapWellness } from '@hub/core';
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
    assert.equal(detail.json().run.avg_power_w, null);
    assert.equal(detail.json().intervals[0].sequence, 0);
    assert.equal(detail.json().intervals[0].avg_power_w, null);
    assert.equal(detail.json().intervals[0].max_power_w, null);
    const unimported = await app.inject({ url: '/api/runs/i123/samples' });
    assert.equal(unimported.statusCode, 200);
    assert.equal(unimported.json().synced_at, null);
    assert.equal(unimported.json().total, 0);
    const samples = mapRunStreams('i123', [
      { type: 'time', data: [0, 1, 5] },
      { type: 'heartrate', data: [100, null, 140] },
      { type: 'altitude', data: [-10, -9, -8] },
      { type: 'fixed_altitude', data: [-11, -10, -9] },
      { type: 'watts', data: [0, 200, 240] },
      { type: 'raw_watts', data: [0, 200, 900] },
    ]);
    await store.saveRun({ ...mapped.run, power_source: 'power' }, mapped.intervals, samples);
    const page = await app.inject({ url: '/api/runs/i123/samples?limit=2&offset=1' });
    assert.equal(page.statusCode, 200);
    assert.equal(page.json().total, 3);
    assert.equal(page.json().power_source, 'power');
    assert.equal(page.json().synced_at, mapped.run.synced_at);
    assert.deepEqual(
      page.json().items.map((s: { sample_index: number }) => s.sample_index),
      [1, 2],
    );
    assert.equal(page.json().items[0].hr_bpm, null);
    assert.equal(page.json().items[1].power_w, 240);
    assert.equal(page.json().items[1].raw_power_w, 900);
    assert.equal(page.json().items[1].corrected_altitude_m, -9);
    assert.equal(
      (await app.inject({ url: '/api/runs/i123/samples?offset=3' })).json().items.length,
      0,
    );
    for (const query of ['limit=101', 'offset=-1', 'offset=200001', 'extra=1'])
      assert.equal((await app.inject({ url: `/api/runs/i123/samples?${query}` })).statusCode, 400);
    assert.equal((await app.inject({ url: '/api/runs/unknown/samples' })).statusCode, 404);
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
    for (const mode of ['all', 'recent']) {
      assert.equal(
        (await app.inject({ method: 'POST', url: '/api/sync-runs', payload: { mode } })).statusCode,
        400,
      );
    }
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
          payload: { mode: 'range', start: '2026-09-20', end: '2026-09-20', unexpected: true },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/sync-runs',
          payload: { mode: 'range', start: '2026-09-20', end: '2026-09-20' },
        })
      ).statusCode,
      503,
    );
    assert.equal(
      (await app.inject({ url: '/api/runs/00000000-0000-4000-8000-000000000000' })).statusCode,
      404,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    await store.close();
    await rm(dir, { recursive: true });
  }
});

test('UI sync waits for import completion and rejects competing imports', async () => {
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
  let fetching: () => void = () => {};
  const requestedUpstream = new Promise<void>((resolve) => {
    fetching = resolve;
  });

  const requested: string[] = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    fetching();
    await blocked;

    if (url.includes('/activities?'))
      return Response.json([
        {
          id: 'i123',
          type: 'Run',
          start_date_local: '2026-09-20T08:00:00',
        },
      ]);

    if (url.includes('/streams.json')) return Response.json([]);

    if (url.includes('/activity/'))
      return Response.json({
        id: 'i123',
        type: 'Run',
        start_date_local: '2026-09-20T08:00:00',
        distance: 5000,
        icu_average_watts: 220,
        icu_intervals: [
          { type: 'WORK', average_watts: 250, max_watts: 400 },
          { type: 'RECOVERY', average_watts: 0, max_watts: 0 },
          { type: 'WORK', average_watts: null, max_watts: null },
        ],
      });

    return Response.json([{ id: '2026-09-20', hrv: 42 }]);
  };

  try {
    for (const range of [
      { start: '2026-01-01', end: '2026-04-01' },
      { start: '2026-09-21', end: '2026-09-20' },
    ]) {
      const invalid = await app.inject({
        method: 'POST',
        url: '/api/sync-runs',
        payload: { mode: 'range', ...range },
      });
      assert.equal(invalid.statusCode, 400);
      assert.equal(invalid.json().error, 'INVALID_INPUT');
    }
    assert.equal(requested.length, 0);
    assert.equal(await store.activeSync(), null);

    const payload = { mode: 'range', start: '2026-09-20', end: '2026-09-20' };
    let finished = false;
    const importing = app
      .inject({ method: 'POST', url: '/api/sync-runs', payload })
      .then((result) => {
        finished = true;
        return result;
      });

    await requestedUpstream;

    assert.equal(finished, false);
    const active = await store.activeSync();
    assert.ok(active);
    const id = active.id;

    const competing = await app.inject({ method: 'POST', url: '/api/sync-runs', payload });
    assert.equal(competing.statusCode, 409);
    assert.equal(competing.json().active.id, id);

    release();
    const completed = await importing;

    assert.equal(completed.statusCode, 200);
    assert.equal(completed.json().status, 'completed');
    assert.equal((await app.inject({ url: '/api/runs/i123' })).json().run.distance_m, 5000);
    const detail = await app.inject({ url: '/api/runs/i123' });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().run.avg_power_w, 220);
    assert.deepEqual(
      detail
        .json()
        .intervals.map((interval: { avg_power_w: number | null; max_power_w: number | null }) => [
          interval.avg_power_w,
          interval.max_power_w,
        ]),
      [
        [250, 400],
        [0, 0],
        [null, null],
      ],
    );
    const runs = await app.inject({ url: '/api/runs' });
    assert.equal(runs.statusCode, 200);
    assert.equal(runs.json().items[0].avg_power_w, 220);
    assert.equal(
      (await app.inject({ url: '/api/health?start=2026-09-20&end=2026-09-20' })).json().items[0]
        .hrv_ms,
      42,
    );
    assert.equal(requested.length, 4);

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
    const importing = app
      .inject({
        method: 'POST',
        url: '/api/sync-runs',
        payload: { mode: 'range', start: '2026-09-20', end: '2026-09-20' },
      })
      .then((response) => response);

    await requested;
    await app.close();
    const completed = await importing;

    assert.equal(completed.statusCode, 200);
    assert.equal(completed.json().status, 'interrupted');
    assert.equal(aborted, true);
    assert.equal((await store.syncRun(completed.json().id))?.status, 'interrupted');
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

test('disconnecting the UI request cancels its import', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-api-disconnect-'));
  const config = loadConfig({
    SQLITE_PATH: join(dir, 'db.sqlite'),
    INTERVALS_API_KEY: 'synthetic',
    APP_ORIGINS: 'http://localhost',
  });

  const store = new Store(config.databasePath);
  await store.migrate();
  const app = buildApp(store, config);
  const originalFetch = globalThis.fetch;
  let fetching: () => void = () => {};
  let cancelled: () => void = () => {};

  const requested = new Promise<void>((resolve) => {
    fetching = resolve;
  });
  const aborted = new Promise<void>((resolve) => {
    cancelled = resolve;
  });

  globalThis.fetch = async (_input, options) => {
    const signal = options?.signal;
    assert.ok(signal);

    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          cancelled();
          reject(signal.reason);
        },
        { once: true },
      );

      fetching();
    });
  };

  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const request = httpRequest(`${address}/api/sync-runs`, {
      method: 'POST',
      headers: { Host: 'localhost', 'Content-Type': 'application/json' },
    });

    request.on('error', () => {});
    request.end(JSON.stringify({ mode: 'range', start: '2026-09-20', end: '2026-09-20' }));
    await requested;

    const run = await store.activeSync();
    assert.ok(run);

    request.destroy();
    await aborted;
    await app.close();

    assert.equal((await store.syncRun(run.id))?.status, 'interrupted');
    assert.equal(await store.acquireLease('next-sync'), true);
    await store.releaseLease('next-sync');
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
    await store.close();
    await rm(dir, { recursive: true });
  }
});

test('all stored runs and wellness are paginated without dates, capped at 50, and read locally', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-api-lists-'));
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
    throw new Error('Unexpected upstream request');
  };
  try {
    for (let index = 0; index < 52; index++) {
      const date = index === 0 ? '1990-01-01' : addDays('2026-09-01', index);
      const mapped = mapActivity(
        { id: `synthetic-${index}`, type: 'Run', start_date_local: `${date}T08:00:00` },
        false,
      );
      await store.saveRun(mapped.run, mapped.intervals);
      await store.saveWellness(mapWellness({ id: date }));
    }
    for (const path of ['/api/runs', '/api/health']) {
      const first = await app.inject({ url: path });
      assert.equal(first.statusCode, 200);
      assert.equal(first.json().total, 52);
      assert.equal(first.json().items.length, 50);
      assert.equal(first.json().limit, 50);
      const second = await app.inject({ url: `${path}?limit=50&offset=50` });
      assert.equal(second.statusCode, 200);
      assert.equal(second.json().total, 52);
      assert.equal(second.json().items.length, 2);
      const items = [...first.json().items, ...second.json().items];
      assert.equal(new Set(items.map((item) => item.id ?? item.date)).size, 52);
      assert.equal((items.at(-1).start_time ?? items.at(-1).date).slice(0, 10), '1990-01-01');
      assert.equal((await app.inject({ url: `${path}?limit=51` })).statusCode, 400);
      assert.equal((await app.inject({ url: `${path}?start=2026-09-01` })).statusCode, 400);
      const filtered = await app.inject({ url: `${path}?start=1990-01-01&end=1990-01-01` });
      assert.equal(filtered.statusCode, 200);
      assert.equal(filtered.json().total, 1);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    await store.close();
    await rm(dir, { recursive: true });
  }
});

test('a late upstream error returns a failed import and publishes none of the staged records', async () => {
  const store = new Store(':memory:');
  await store.migrate();
  const app = buildApp(
    store,
    loadConfig({ INTERVALS_API_KEY: 'synthetic', APP_ORIGINS: 'http://localhost' }),
  );
  const originalFetch = globalThis.fetch;
  let wellnessRequests = 0;
  const activity = {
    id: 'synthetic',
    type: 'Run',
    start_date_local: '2026-09-20T08:00:00',
    icu_intervals: [],
  };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/activities')) return Response.json([activity]);
    if (url.pathname.endsWith('/streams.json')) return Response.json([{ type: 'time', data: [0] }]);
    if (url.pathname.endsWith('/wellness')) {
      wellnessRequests++;
      return new Response('', { status: 503 });
    }
    return Response.json(activity);
  };
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sync-runs',
      payload: {
        mode: 'range',
        start: '2026-09-20',
        end: '2026-09-20',
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, 'failed');
    assert.equal(response.json().upserted, 0);
    assert.equal(response.json().error_code, 'HTTP_503');
    assert.equal(wellnessRequests, 1);
    assert.equal((await app.inject({ url: '/api/runs' })).json().total, 0);
    assert.equal((await app.inject({ url: '/api/health' })).json().total, 0);
    assert.deepEqual(await store.coverage(), []);
    assert.equal(await store.activeSync(), null);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    await store.close();
  }
});

test('expired imports are not active and a new web import recovers abandoned history without upstream reads', async () => {
  const store = new Store(':memory:');
  await store.migrate();
  const config = loadConfig({ INTERVALS_API_KEY: 'synthetic', APP_ORIGINS: 'http://localhost' });
  const app = buildApp(store, config);
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls++;
    return Response.json([]);
  };
  try {
    const old = await beginSync(
      store,
      { mode: 'range', start: '2026-09-20', end: '2026-09-20' },
      config.timezone,
    );
    assert.equal((await app.inject({ url: '/api/status' })).json().active.id, old.id);
    store.sqlite.prepare('UPDATE leases SET expires_at = 0').run();
    const status = await app.inject({ url: '/api/status' });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().active, null);
    assert.equal(upstreamCalls, 0);
    assert.equal((await store.syncRun(old.id))?.status, 'running');
    const next = await app.inject({
      method: 'POST',
      url: '/api/sync-runs',
      payload: {
        mode: 'range',
        start: '2026-09-20',
        end: '2026-09-20',
      },
    });
    assert.equal(next.statusCode, 200);
    assert.equal(next.json().status, 'completed');
    assert.equal((await store.syncRun(old.id))?.status, 'interrupted');
    assert.equal(upstreamCalls, 2);
    assert.equal((await app.inject({ url: '/api/status' })).json().active, null);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    await store.close();
  }
});
