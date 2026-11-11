import assert from 'node:assert/strict';
import test from 'node:test';
import type { SyncRequest } from '@hub/contracts';
import { Store } from '@hub/db';
import { beginSync, executeSync, loadConfig } from '../src/index.ts';

const range = { start: '2026-09-20', end: '2026-09-20' };
const activity = (id: string, date = range.start, distance = 5) => ({
  id,
  type: 'Run',
  start_date_local: `${date}T08:00:00`,
  distance,
  icu_intervals: [{ type: 'WORK', start_index: 0, end_index: 2, elapsed_time: 2, distance }],
});
const streams = [
  { type: 'time', data: [0, 1] },
  { type: 'heartrate', data: [120, 130] },
];
async function snapshot(store: Store) {
  return {
    runs: await store.db.selectFrom('runs').selectAll().orderBy('id').execute(),
    intervals: await store.db
      .selectFrom('run_intervals')
      .selectAll()
      .orderBy('run_id')
      .orderBy('sequence')
      .execute(),
    samples: await store.db
      .selectFrom('run_samples')
      .selectAll()
      .orderBy('run_id')
      .orderBy('sample_index')
      .execute(),
    wellness: await store.db.selectFrom('wellness').selectAll().orderBy('date').execute(),
    coverage: await store.coverage(),
  };
}
async function setup() {
  const store = new Store(':memory:');
  await store.migrate();
  const config = loadConfig({ INTERVALS_API_KEY: 'synthetic' });
  const sync = async (
    fetch: typeof globalThis.fetch,
    signal?: AbortSignal,
    request: SyncRequest = { mode: 'range', ...range },
  ) => {
    const run = await beginSync(store, request, config.timezone);
    return executeSync(store, config, run.id, { fetch, signal });
  };
  const baseline = await sync(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/activities')) return Response.json([activity('existing')]);
    if (url.pathname.endsWith('/wellness')) return Response.json([{ id: range.start, hrv: 40 }]);
    if (url.pathname.endsWith('/streams.json')) return Response.json(streams);
    return Response.json(activity('existing'));
  });
  assert.equal(baseline.status, 'completed');
  return { store, sync };
}

test('the first detail, stream, validation, network, rate-limit, commit or cancellation error discards the entire batch', async (context) => {
  for (const failure of [
    'detail',
    'streams',
    'validation',
    'network',
    'rate-limit',
    'commit',
    'cancel',
    'lease',
  ] as const) {
    await context.test(failure, async () => {
      const { store, sync } = await setup();
      const before = await snapshot(store);
      const requests: string[] = [];
      const controller = new AbortController();
      if (failure === 'commit')
        store.sqlite.exec(`CREATE TRIGGER synthetic_failure BEFORE INSERT ON wellness
        BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`);
      try {
        const result = await sync(async (input) => {
          const url = new URL(String(input));
          requests.push(url.pathname);
          if (url.pathname.endsWith('/activities'))
            return Response.json([activity('existing'), activity('new')]);
          if (url.pathname.endsWith('/wellness')) {
            // Even after every run is staged, concurrent local reads still see the old snapshot.
            assert.deepEqual(await snapshot(store), before);
            if (failure === 'network') throw new Error('synthetic network error');
            if (failure === 'rate-limit') return new Response('', { status: 429 });
            if (failure === 'validation')
              return Response.json([
                { id: range.start, hrv: 99 },
                { id: '2026-09-19', hrv: 50 },
                { id: range.end, hrv: 77 },
              ]);
            if (failure === 'cancel') controller.abort();
            if (failure === 'lease') {
              store.sqlite.prepare('UPDATE leases SET expires_at = 0').run();
              assert.equal(await store.acquireLease('other-owner'), true);
            }
            return Response.json([{ id: range.start, hrv: 99 }]);
          }
          if (url.pathname.endsWith('/streams.json')) {
            if (failure === 'streams' && url.pathname.includes('/new/'))
              return Response.json([
                { type: 'time', data: [0, 1] },
                { type: 'heartrate', data: [120] },
              ]);
            return Response.json(streams);
          }
          if (failure === 'detail' && url.pathname.endsWith('/new'))
            return new Response('', { status: 404 });
          return Response.json(
            activity(url.pathname.endsWith('/existing') ? 'existing' : 'new', range.start, 8),
          );
        }, controller.signal);
        assert.equal(
          result.status,
          failure === 'cancel' || failure === 'lease' ? 'interrupted' : 'failed',
        );
        assert.equal(result.upserted, 0);
        assert.equal((await store.issues(result.id)).length, 1);
        assert.deepEqual(await snapshot(store), before);
        assert.equal(await store.getRun('new'), null);
        assert.equal((await store.syncRun(result.id))?.status, result.status);
        if (failure === 'detail') assert.equal(requests.at(-1), '/api/v1/activity/new');
        if (failure === 'streams')
          assert.equal(requests.at(-1), '/api/v1/activity/new/streams.json');
        if (failure === 'network' || failure === 'rate-limit') {
          assert.equal(requests.filter((p) => p.endsWith('/wellness')).length, 1);
          assert.equal(result.error_code, failure === 'network' ? 'NETWORK_ERROR' : 'HTTP_429');
        }
        if (failure === 'commit') assert.equal(result.error_code, 'IMPORT_COMMIT_FAILED');
        if (failure === 'lease') {
          assert.equal(result.error_code, 'LEASE_LOST');
          assert.equal(await store.acquireLease('next'), false);
          await store.releaseLease('other-owner');
        }
        assert.equal(await store.activeSync(), null);
        assert.equal(await store.acquireLease('next'), true);
        await store.releaseLease('next');
      } finally {
        await store.close();
      }
    });
  }
});

test('a successful batch publishes every staged resource with coverage and its completed sync record', async () => {
  const { store, sync } = await setup();
  try {
    const before = await snapshot(store);
    const result = await sync(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/activities'))
        return Response.json([activity('existing'), activity('new')]);
      if (url.pathname.endsWith('/wellness')) {
        assert.deepEqual(await snapshot(store), before);
        return Response.json([{ id: range.start, hrv: 99 }]);
      }
      if (url.pathname.endsWith('/streams.json')) return Response.json(streams);
      return Response.json(
        activity(url.pathname.endsWith('/existing') ? 'existing' : 'new', range.start, 8),
      );
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.upserted, 3);
    assert.equal(result.completed_windows, result.total_windows);
    const after = await snapshot(store);
    assert.equal(after.runs.length, 2);
    assert.equal(after.samples.length, 4);
    assert.equal(after.runs[0].distance_m, 8);
    assert.equal(after.wellness[0].hrv_ms, 99);
    assert.ok(after.coverage.every((row) => row.run_id === result.id));
    assert.equal((await store.syncRun(result.id))?.status, 'completed');
  } finally {
    await store.close();
  }
});

test('reimporting a date fetches every resource again and replaces its measurements', async () => {
  const { store, sync } = await setup();
  const requested: string[] = [];
  try {
    const result = await sync(async (input) => {
      const url = new URL(String(input));
      requested.push(url.pathname);
      if (url.pathname.endsWith('/activities')) return Response.json([activity('existing')]);
      if (url.pathname.endsWith('/wellness')) return Response.json([{ id: range.start, hrv: 88 }]);
      if (url.pathname.endsWith('/streams.json'))
        return Response.json([streams[0], { type: 'heartrate', data: [140, 150] }]);
      return Response.json(activity('existing', range.start, 10));
    });
    assert.equal(result.status, 'completed');
    assert.equal(requested.length, 4);
    const after = await snapshot(store);
    assert.equal(after.runs.length, 1);
    assert.equal(after.runs[0].distance_m, 10);
    assert.deepEqual(
      after.samples.map((sample) => sample.hr_bpm),
      [140, 150],
    );
    assert.equal(after.intervals.length, 1);
    assert.equal(after.wellness[0].hrv_ms, 88);
    assert.ok(after.coverage.every((row) => row.run_id === result.id));
  } finally {
    await store.close();
  }
});
