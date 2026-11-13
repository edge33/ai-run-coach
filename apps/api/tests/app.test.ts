import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { addDays, lapSchema, runSampleSchema, splitSchema } from '@hub/contracts';
import { beginSync, loadConfig } from '@hub/core';
import { Store } from '@hub/db';
import {
  garminFetch,
  syntheticRun,
  syntheticWellness,
} from '../../../packages/core/tests/fixtures.ts';
import { buildApp } from '../src/app.ts';

test('HTTP reads expose Garmin laps, splits and samples locally and enforce schemas and origins', async () => {
  const store = new Store(':memory:');
  await store.initialize();
  const app = buildApp(store, loadConfig({ APP_ORIGINS: 'http://localhost' }));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('Unexpected upstream request');
  };
  try {
    assert.equal((await app.inject('/api/status')).json().run_count, 0);
    await store.saveRun(
      syntheticRun(),
      [lapSchema.parse({ run_id: '123', sequence: 0 })],
      [splitSchema.parse({ run_id: '123', sequence: 0, split_type: 'intervalActive' })],
      [0, 1, 5].map((elapsed, index) =>
        runSampleSchema.parse({
          run_id: '123',
          sample_index: index,
          elapsed_s: elapsed,
          power_w: index === 0 ? 0 : null,
          altitude_m: -5,
        }),
      ),
    );
    await store.saveWellness(syntheticWellness({ hrv_ms: 42 }));
    const response = await app.inject('/api/runs/123');
    assert.equal(response.statusCode, 200);
    const detail = response.json();
    assert.equal(detail.source, 'garmin_connect');
    assert.equal(detail.laps.length, 1);
    assert.equal(detail.splits[0].split_type, 'intervalActive');
    assert.equal(Object.hasOwn(detail, 'intervals'), false);
    assert.equal(Object.hasOwn(detail.run, 'training_load'), false);
    const page = (await app.inject('/api/runs/123/samples?limit=2&offset=1')).json();
    assert.equal(page.total, 3);
    assert.equal(page.items[0].power_w, null);
    assert.deepEqual(
      page.items.map((sample: { sample_index: number }) => sample.sample_index),
      [1, 2],
    );
    assert.equal(page.items[1].altitude_m, -5);
    assert.equal(Object.hasOwn(page, 'power_source'), false);
    for (const query of ['limit=101', 'offset=-1', 'offset=200001', 'extra=1']) {
      assert.equal((await app.inject(`/api/runs/123/samples?${query}`)).statusCode, 400);
    }
    for (const query of ['interval_offset=0', 'lap_offset=-1', 'split_offset=10001']) {
      assert.equal((await app.inject(`/api/runs/123?${query}`)).statusCode, 400);
    }
    assert.equal((await app.inject('/api/runs/unknown')).statusCode, 404);
    assert.equal((await app.inject('/api/runs/unknown/samples')).statusCode, 404);
    for (const metric of ['training_load', 'fitness_ctl', 'fatigue_atl', 'form_tsb']) {
      assert.equal(
        (await app.inject(`/api/summaries/health?start=2026-09-20&end=2026-09-20&metric=${metric}`))
          .statusCode,
        400,
      );
    }
    assert.equal(
      (await app.inject({ url: '/api/status', headers: { origin: 'http://evil.example' } }))
        .statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ url: '/api/status', headers: { host: 'evil.example' } })).statusCode,
      403,
    );
    assert.equal((await app.inject('/api/runs?start=2026-02-30&end=2026-09-21')).statusCode, 400);
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
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    await store.close();
  }
});

test('manual Garmin sync waits for completion, rejects concurrent writers and publishes normalized records', async () => {
  const store = new Store(':memory:');
  await store.initialize();
  const app = buildApp(
    store,
    loadConfig({
      APP_ORIGINS: 'http://localhost',
      GARMIN_API_KEY: 'synthetic',
      GARMIN_REQUEST_INTERVAL_MS: '0',
    }),
  );
  const originalFetch = globalThis.fetch;
  let release = () => {};
  let fetching = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    fetching = resolve;
  });
  const base = garminFetch();
  globalThis.fetch = async (input, options) => {
    fetching();
    await blocked;
    return base(input, options);
  };
  const payload = { mode: 'range', start: '2026-09-20', end: '2026-09-20' };
  try {
    for (const invalid of [
      { mode: 'all' },
      { mode: 'recent' },
      { ...payload, end: '2026-09-19' },
      { ...payload, extra: true },
    ]) {
      assert.equal(
        (await app.inject({ method: 'POST', url: '/api/sync-runs', payload: invalid })).statusCode,
        400,
      );
    }
    let finished = false;
    const importing = app
      .inject({ method: 'POST', url: '/api/sync-runs', payload })
      .then((result) => {
        finished = true;
        return result;
      });
    await requested;
    assert.equal(finished, false);
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/sync-runs', payload })).statusCode,
      409,
    );
    release();
    const completed = await importing;
    assert.equal(completed.statusCode, 200);
    assert.equal(completed.json().status, 'completed');
    const detail = (await app.inject('/api/runs/123')).json();
    assert.equal(detail.run.avg_power_w, 220);
    assert.equal(detail.laps[0].max_power_w, 400);
    assert.equal(detail.splits[0].split_type, 'intervalActive');
    assert.equal((await app.inject('/api/health')).json().items[0].resting_hr_bpm, 50);
    assert.equal(await store.activeSync(), null);
  } finally {
    release();
    globalThis.fetch = originalFetch;
    await app.close();
    await store.close();
  }
});
test('API shutdown cancels an upstream request, preserves data, and releases the sync lease', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-api-shutdown-'));
  const config = loadConfig({
    SQLITE_PATH: join(dir, 'db.sqlite'),
    GARMIN_API_KEY: 'synthetic',
    GARMIN_REQUEST_INTERVAL_MS: '0',
    APP_ORIGINS: 'http://localhost',
  });

  const store = new Store(config.databasePath);
  await store.initialize();
  await store.saveWellness(syntheticWellness({ hrv_ms: 42 }));

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
    GARMIN_API_KEY: 'synthetic',
    GARMIN_REQUEST_INTERVAL_MS: '0',
    APP_ORIGINS: 'http://localhost',
  });

  const store = new Store(config.databasePath);
  await store.initialize();
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
  await store.initialize();
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
      await store.saveRun(
        syntheticRun({ id: `synthetic-${index}`, start_time: `${date}T08:00:00` }),
        [],
        [],
        [],
      );
      await store.saveWellness(syntheticWellness({ date }));
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

test('a late Garmin failure publishes none of the staged records and is not retried', async () => {
  const store = new Store(':memory:');
  await store.initialize();
  const app = buildApp(
    store,
    loadConfig({
      APP_ORIGINS: 'http://localhost',
      GARMIN_API_KEY: 'synthetic',
      GARMIN_REQUEST_INTERVAL_MS: '0',
    }),
  );
  const originalFetch = globalThis.fetch;
  const base = garminFetch();
  let failures = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/sleep/')) {
      failures++;
      return new Response('private error', { status: 503 });
    }
    return base(input, init);
  };
  try {
    const result = await app.inject({
      method: 'POST',
      url: '/api/sync-runs',
      payload: { mode: 'range', start: '2026-09-20', end: '2026-09-20' },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().status, 'failed');
    assert.equal(result.json().error_code, 'HTTP_503');
    assert.equal(result.json().upserted, 0);
    assert.equal(failures, 1);
    assert.equal((await store.listRuns()).total, 0);
    assert.equal((await store.listWellness()).total, 0);
    assert.deepEqual(await store.coverage(), []);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    await store.close();
  }
});

test('expired imports are not active and the next manual request recovers abandoned history', async () => {
  const store = new Store(':memory:');
  await store.initialize();
  const config = loadConfig({
    APP_ORIGINS: 'http://localhost',
    GARMIN_API_KEY: 'synthetic',
    GARMIN_REQUEST_INTERVAL_MS: '0',
  });
  const app = buildApp(store, config);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = garminFetch({ empty: true });
  try {
    const old = await beginSync(
      store,
      { mode: 'range', start: '2026-09-20', end: '2026-09-20' },
      config.timezone,
    );
    store.sqlite.prepare('UPDATE leases SET expires_at = 0').run();
    assert.equal((await app.inject('/api/status')).json().active, null);
    assert.equal((await store.syncRun(old.id))?.status, 'running');
    const next = await app.inject({
      method: 'POST',
      url: '/api/sync-runs',
      payload: { mode: 'range', start: '2026-09-20', end: '2026-09-20' },
    });
    assert.equal(next.json().status, 'completed');
    assert.equal((await store.syncRun(old.id))?.status, 'interrupted');
    assert.equal((await app.inject('/api/status')).json().active, null);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    await store.close();
  }
});

test('UI import endpoint reports Garmin contract changes, preserves prior records and permits manual retry', async () => {
  const store = new Store(':memory:');
  await store.initialize();
  const config = loadConfig({
    APP_ORIGINS: 'http://localhost',
    GARMIN_API_KEY: 'synthetic',
    GARMIN_REQUEST_INTERVAL_MS: '0',
  });
  const app = buildApp(store, config);
  const originalFetch = globalThis.fetch;
  const payload = { mode: 'range', start: '2026-09-20', end: '2026-09-20' };
  const submit = () => app.inject({ method: 'POST', url: '/api/sync-runs', payload });
  try {
    globalThis.fetch = garminFetch();
    assert.equal((await submit()).json().status, 'completed');
    const before = await store.getRun('123');
    const coverage = await store.coverage();
    const base = garminFetch({ distance: 9000 });
    let changedResponses = 0;
    globalThis.fetch = async (input, init) => {
      if (String(input).includes('/sleep/')) {
        changedResponses++;
        return Response.json({
          calendarDate: payload.start,
          renamedSleep: 25000,
          privateNotes: 'private body',
        });
      }
      return base(input, init);
    };
    const result = await submit();
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().status, 'failed');
    assert.equal(result.json().error_code, 'GARMIN_CONTRACT_CHANGED');
    assert.equal(result.json().upserted, 0);
    assert.equal(changedResponses, 1);
    assert.ok(!result.body.includes('private body'));
    assert.deepEqual(await store.getRun('123'), before);
    assert.deepEqual(await store.coverage(), coverage);
    const status = (await app.inject('/api/status')).json();
    assert.equal(status.latest.error_code, 'GARMIN_CONTRACT_CHANGED');
    assert.equal(status.active, null);
    assert.equal(changedResponses, 1); // Reading status never retries an import.
    globalThis.fetch = base;
    assert.equal((await submit()).json().status, 'completed');
    assert.equal((await store.getRun('123'))?.run.distance_m, 9000);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    await store.close();
  }
});

test('bulk sleep allows empty undated placeholders and rejects malformed or undated measurements without stopping the API', async () => {
  const store = new Store(':memory:');
  await store.initialize();
  const app = buildApp(
    store,
    loadConfig({
      APP_ORIGINS: 'http://localhost',
      GARMIN_API_KEY: 'synthetic',
      GARMIN_REQUEST_INTERVAL_MS: '0',
    }),
  );
  const originalFetch = globalThis.fetch;
  const base = garminFetch();
  let sleep: unknown = [
    { calendarDate: '2026-09-20', sleepTimeSeconds: 0 },
    { calendarDate: null, sleepTimeSeconds: 0 },
  ];
  globalThis.fetch = async (input, init) =>
    String(input).includes('/sleep/') ? Response.json(sleep) : base(input, init);
  const submit = () =>
    app.inject({
      method: 'POST',
      url: '/api/sync-runs',
      payload: {
        mode: 'range',
        start: '2026-09-20',
        end: '2026-09-20',
      },
    });
  try {
    assert.equal((await submit()).json().status, 'completed');
    const before = await store.listWellness();
    assert.equal(before.items[0].date, '2026-09-20');
    assert.equal(before.items[0].sleep_duration_s, 0);
    sleep = [{ calendarDate: 123, sleepTimeSeconds: 100 }];
    const failed = await submit();
    assert.equal(failed.statusCode, 200);
    assert.equal(failed.json().status, 'failed');
    assert.equal(failed.json().error_code, 'GARMIN_CONTRACT_CHANGED');
    assert.equal(failed.json().upserted, 0);
    assert.deepEqual(await store.listWellness(), before);
    assert.equal((await app.inject('/healthz')).statusCode, 200);
    assert.equal((await app.inject('/api/health')).statusCode, 200);
    assert.equal((await app.inject('/api/status')).json().active, null);
    sleep = [{ calendarDate: null, sleepTimeSeconds: 25000 }];
    assert.equal((await submit()).json().error_code, 'GARMIN_CONTRACT_CHANGED');
    assert.deepEqual(await store.listWellness(), before);
    sleep = [{ calendarDate: null, sleepTimeSeconds: 0 }];
    assert.equal((await submit()).json().status, 'completed');
    assert.equal((await store.listWellness()).items[0].sleep_duration_s, null);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    await store.close();
  }
});

test('Garmin Retry-After is exposed in status and blocks another UI import without upstream calls', async () => {
  const store = new Store(':memory:');
  await store.initialize();
  const app = buildApp(
    store,
    loadConfig({
      APP_ORIGINS: 'http://localhost',
      GARMIN_API_KEY: 'synthetic',
      GARMIN_REQUEST_INTERVAL_MS: '0',
    }),
  );
  const originalFetch = globalThis.fetch;
  const base = garminFetch();
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    if (String(input).includes('/sleep/'))
      return new Response('', { status: 429, headers: { 'retry-after': '120' } });
    return base(input, init);
  };
  const submit = () =>
    app.inject({
      method: 'POST',
      url: '/api/sync-runs',
      payload: {
        mode: 'range',
        start: '2026-09-20',
        end: '2026-09-20',
      },
    });
  try {
    const failed = await submit();
    assert.equal(failed.json().status, 'failed');
    assert.equal(failed.json().error_code, 'HTTP_429');
    const previousCalls = calls;
    const status = (await app.inject('/api/status')).json();
    assert.ok(Date.parse(status.cooldown_until) > Date.now());
    assert.equal(status.active, null);
    const blocked = await submit();
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.json().error, 'GARMIN_RATE_LIMITED');
    assert.equal(blocked.json().cooldown_until, status.cooldown_until);
    assert.ok(Number(blocked.headers['retry-after']) > 0);
    assert.equal(calls, previousCalls);
    assert.equal((await store.syncHistory()).length, 1);
    assert.equal((await store.listRuns()).total, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    await store.close();
  }
});
