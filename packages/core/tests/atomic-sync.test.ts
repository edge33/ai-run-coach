import assert from 'node:assert/strict';
import test from 'node:test';
import { Store } from '@hub/db';
import { beginSync, executeSync, loadConfig } from '../src/index.ts';
import { garminFetch } from './fixtures.ts';

const range = { start: '2026-09-20', end: '2026-09-20' };
async function snapshot(store: Store) {
  return {
    runs: await store.db.selectFrom('runs').selectAll().execute(),
    laps: await store.db.selectFrom('run_laps').selectAll().execute(),
    splits: await store.db.selectFrom('run_splits').selectAll().execute(),
    samples: await store.db.selectFrom('run_samples').selectAll().execute(),
    wellness: await store.db.selectFrom('wellness').selectAll().execute(),
    coverage: await store.coverage(),
  };
}

test('Garmin import publishes complete records idempotently and aborts the entire batch on errors', async (t) => {
  for (const failure of [
    'detail',
    'file',
    'validation',
    'contract',
    'network',
    'rate-limit',
    'commit',
    'cancel',
    'lease',
  ])
    await t.test(failure, async () => {
      const store = new Store(':memory:');
      await store.initialize();
      const config = loadConfig({ GARMIN_API_KEY: 'synthetic', GARMIN_REQUEST_INTERVAL_MS: '0' });
      const sync = async (fetch: typeof globalThis.fetch, signal?: AbortSignal) => {
        const run = await beginSync(store, { mode: 'range', ...range }, config.timezone);
        return executeSync(store, config, run.id, { fetch, signal });
      };
      try {
        assert.equal((await sync(garminFetch())).status, 'completed');
        const before = await snapshot(store);
        const controller = new AbortController();
        const base = garminFetch({ distance: 9000 });
        let failures = 0;
        if (failure === 'commit')
          store.sqlite.exec(
            "CREATE TRIGGER synthetic_failure BEFORE INSERT ON wellness BEGIN SELECT RAISE(ABORT, 'synthetic'); END",
          );
        const fetch: typeof globalThis.fetch = async (input, init) => {
          const path = new URL(String(input)).pathname;
          if (failure === 'detail' && path === '/activity-service/activity/123') {
            failures++;
            return new Response('', { status: 404 });
          }
          if (failure === 'file' && path.includes('/files/')) {
            failures++;
            return new Response('not FIT');
          }
          if (path.includes('/sleep/')) {
            if (failure === 'validation')
              return Response.json([{ calendarDate: '2026-09-21', sleepTimeSeconds: 25000 }]);
            if (failure === 'contract')
              return Response.json([{ calendarDate: range.start, sleepDuration: 25000 }]);
            if (failure === 'network') {
              failures++;
              throw new Error('private body');
            }
            if (failure === 'rate-limit') {
              failures++;
              return new Response('private body', { status: 429 });
            }
            if (failure === 'cancel') controller.abort();
            if (failure === 'lease') store.sqlite.prepare('UPDATE leases SET expires_at = 0').run();
          }
          return base(input, init);
        };
        const result = await sync(fetch, controller.signal);
        assert.equal(
          result.status,
          ['cancel', 'lease'].includes(failure) ? 'interrupted' : 'failed',
        );
        assert.equal(result.upserted, 0);
        if (failure === 'contract') assert.equal(result.error_code, 'GARMIN_CONTRACT_CHANGED');
        assert.deepEqual(await snapshot(store), before);
        assert.equal(await store.activeSync(), null);
        assert.ok((await store.issues(result.id)).length);
        if (['detail', 'file', 'network', 'rate-limit'].includes(failure))
          assert.equal(failures, 1);
      } finally {
        await store.close();
      }
    });
});

test('successful reimports replace complete lap, split and sample sets with source provenance', async () => {
  const store = new Store(':memory:');
  await store.initialize();
  const config = loadConfig({ GARMIN_API_KEY: 'synthetic', GARMIN_REQUEST_INTERVAL_MS: '0' });
  try {
    for (const distance of [5000, 6000]) {
      const run = await beginSync(store, { mode: 'range', ...range }, config.timezone);
      const result = await executeSync(store, config, run.id, { fetch: garminFetch({ distance }) });
      assert.equal(result.status, 'completed');
      assert.equal(result.upserted, 2);
      assert.equal(result.completed_windows, result.total_windows);
    }
    const detail = await store.getRun('123');
    assert.equal(detail?.run.distance_m, 6000);
    assert.equal(detail?.source, 'garmin_connect');
    assert.equal(detail?.laps.length, 1);
    assert.equal(detail?.splits.length, 1);
    assert.equal(detail?.splits[0].split_type, 'intervalActive');
    assert.equal((await store.getRunSamples('123'))?.total, 3);
    assert.equal((await store.listRuns()).total, 1);
  } finally {
    await store.close();
  }
});

test('31-day resource windows stage atomically across the full 90-day request', async () => {
  const store = new Store(':memory:');
  await store.initialize();
  const config = loadConfig({ GARMIN_API_KEY: 'synthetic', GARMIN_REQUEST_INTERVAL_MS: '0' });
  const requested: string[] = [];
  const base = garminFetch({ empty: true });
  try {
    const run = await beginSync(
      store,
      { mode: 'range', start: '2026-01-01', end: '2026-03-31' },
      config.timezone,
    );
    const result = await executeSync(store, config, run.id, {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname.includes('/weight/')) requested.push(url.pathname);
        return base(input, init);
      },
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.upserted, 90);
    assert.equal(requested.length, 3);
    assert.equal((await store.coverage()).length, 6);
  } finally {
    await store.close();
  }
});
