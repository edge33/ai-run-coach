import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { addDays, localToday, validateRange } from '@hub/contracts';
import { Store } from '@hub/db';
import {
  beginSync,
  executeSync,
  exportData,
  IntervalsClient,
  loadConfig,
  mapActivity,
  mapWellness,
  summarizeHealth,
  summarizeRuns,
  Wiki,
} from '../src/index.ts';

const activity = {
  id: 'i123',
  type: 'Run',
  start_date_local: '2026-09-20T08:00:00',
  distance: 5000,
  moving_time: 1800,
  elapsed_time: 1900,
  average_speed: 2.6,
  icu_average_watts: 220,
  total_elevation_loss: 65,
  icu_intervals: [
    { type: 'WORK', distance: 4000, elapsed_time: 1400, average_watts: 250, max_watts: 400 },
    { type: 'RECOVERY', distance: 1000, elapsed_time: 500, average_watts: 0, max_watts: 0 },
  ],
};
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'hub-core-'));
  const config = loadConfig({
    SQLITE_PATH: join(dir, 'db.sqlite'),
    WIKI_PATH: join(dir, 'wiki'),
    INTERVALS_API_KEY: 'test-key',
  });
  const store = new Store(config.databasePath);
  await store.migrate();
  return {
    dir,
    config,
    store,
    close: async () => {
      await store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('local dates and bounded ranges remain independent of UTC', () => {
  assert.equal(localToday('Europe/Rome', new Date('2026-03-28T23:30:00Z')), '2026-03-29');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30');
  assert.throws(() => validateRange({ start: '2026-02-30', end: '2026-03-01' }));
  assert.throws(() => validateRange({ start: '2026-09-22', end: '2026-09-20' }));
  assert.equal(mapActivity(activity, false).run.start_time, activity.start_date_local);
});

test('recent sync retrieves 15 local dates for runs and health across a DST boundary', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-28T23:30:00Z') });
  const t = await setup();
  const requests: URL[] = [];

  try {
    const run = await beginSync(t.store, { mode: 'recent' }, 'Europe/Rome');
    assert.equal(run.start, '2026-03-15');
    assert.equal(run.end, '2026-03-29');

    const result = await executeSync(t.store, t.config, run.id, {
      fetch: async (input) => {
        requests.push(new URL(String(input)));
        return Response.json([]);
      },
    });

    assert.equal(result.status, 'completed');
    assert.equal(requests.length, 2);
    assert.ok(requests[0].pathname.endsWith('/activities'));
    assert.equal(requests[0].searchParams.get('oldest'), '2026-03-15T00:00:00');
    assert.equal(requests[0].searchParams.get('newest'), '2026-03-29T23:59:59');
    assert.ok(requests[1].pathname.endsWith('/wellness'));
    assert.equal(requests[1].searchParams.get('oldest'), '2026-03-15');
    assert.equal(requests[1].searchParams.get('newest'), '2026-03-29');
  } finally {
    await t.close();
  }
});

test('sync rejects oversized, reversed, and future ranges before acquiring a lease', async () => {
  const t = await setup();
  const fetch: typeof globalThis.fetch = async () => Response.json([]);
  try {
    for (const range of [
      { start: '2026-01-01', end: '2026-04-01' },
      { start: '2026-02-01', end: '2026-01-31' },
      { start: '9999-01-01', end: '9999-01-01' },
    ]) {
      await assert.rejects(beginSync(t.store, { mode: 'range', ...range }, t.config.timezone));
    }
    assert.equal((await t.store.syncHistory(50, 0)).length, 0);
    const run = await beginSync(
      t.store,
      { mode: 'range', start: '2026-01-01', end: '2026-03-31' },
      t.config.timezone,
    );
    assert.equal((await executeSync(t.store, t.config, run.id, { fetch })).status, 'completed');
  } finally {
    await t.close();
  }
});

test('mapping retains requested fields, zero, null, negative form, and interval order', () => {
  const mapped = mapActivity({ ...activity, unknown_future_field: 'secret' }, true);
  assert.equal(mapped.run.id, 'i123');
  assert.equal(mapped.run.duration_s, 1900);
  assert.equal(mapped.run.moving_time_s, 1800);
  assert.equal(mapped.run.avg_power_w, 220);
  assert.equal(Object.hasOwn(mapped.run, 'max_power_w'), false);
  assert.equal(mapped.run.elevation_loss_m, 65);
  const zero = mapActivity({ ...activity, icu_average_watts: 0, total_elevation_loss: 0 }, true);
  assert.equal(zero.run.avg_power_w, 0);
  assert.equal(zero.run.elevation_loss_m, 0);
  const missing = mapActivity(
    { ...activity, icu_average_watts: null, total_elevation_loss: undefined },
    true,
  );
  assert.equal(missing.run.avg_power_w, null);
  assert.equal(missing.run.elevation_loss_m, null);
  assert.throws(() => mapActivity({ ...activity, total_elevation_loss: -1 }, true));
  assert.deepEqual(
    mapped.intervals?.map((part) => part.interval_type),
    ['WORK', 'RECOVERY'],
  );
  assert.equal(mapped.intervals?.[0].avg_power_w, 250);
  assert.equal(mapped.intervals?.[0].max_power_w, 400);
  assert.equal(mapped.intervals?.[1].avg_power_w, 0);
  assert.equal(mapped.intervals?.[1].max_power_w, 0);
  assert.equal(Object.hasOwn(mapped.intervals?.[0] ?? {}, 'elevation_loss_m'), false);
  const missingIntervalPower = mapActivity(
    {
      ...activity,
      icu_intervals: [{ type: 'WORK', average_watts: null, max_watts: null }, { type: 'RECOVERY' }],
    },
    true,
  );
  for (const interval of missingIntervalPower.intervals ?? []) {
    assert.equal(interval.avg_power_w, null);
    assert.equal(interval.max_power_w, null);
  }
  assert.throws(() => mapActivity({ ...activity, icu_intervals: [{ average_watts: -1 }] }, true));
  assert.throws(() => mapActivity({ ...activity, icu_intervals: [{ max_watts: -1 }] }, true));
  assert.equal(JSON.stringify(mapped).includes('unknown_future_field'), false);
  assert.throws(() => mapActivity({ ...activity, icu_intervals: undefined }, true));
  assert.throws(() => mapActivity({ ...activity, distance: -1 }, false));
  assert.throws(() => mapActivity({ ...activity, type: 'Ride' }, false), /NOT_RUNNING/);
  assert.equal(mapActivity({ ...activity, type: 'TrailRun' }, false).run.id, 'i123');
  assert.equal(mapActivity({ ...activity, trainer: true }, false).run.indoor, 1);
  assert.equal(mapActivity({ ...activity, type: 'VirtualRun' }, false).run.indoor, null);
  assert.equal(
    mapActivity({ ...activity, type: 'VirtualRun', trainer: true }, false).run.indoor,
    1,
  );
  const day = mapWellness({
    id: '2026-09-20',
    restingHR: 0,
    hrv: 42,
    hrvSDNN: 90,
    ctl: 10,
    atl: 12,
    ctlLoad: 0,
    unknown_future_field: 'secret',
  });
  assert.equal(day.resting_hr_bpm, 0);
  assert.equal(day.hrv_ms, 42);
  assert.equal(day.form_tsb, -2);
  assert.equal(day.training_load, 0);
  assert.equal(day.sleep_duration_s, null);
  assert.equal(JSON.stringify(day).includes('unknown_future_field'), false);
  assert.equal(mapWellness({ id: '2026-09-20', ctl: 10 }).form_tsb, null);
});

test('overlapping syncs update runs and wellness without duplicates and preserve runs after detail failure', async () => {
  const t = await setup();
  let distance = 5000;
  let failDetail = false;
  let emptyDetail = false;
  let calls = 0;
  const fakeFetch: typeof fetch = async (input) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://intervals.icu');
    if (url.pathname.endsWith('/activities'))
      return Response.json([
        failDetail
          ? { id: activity.id, type: activity.type, start_date_local: activity.start_date_local }
          : { ...activity, distance },
        ...(failDetail
          ? [{ id: 'new-run', type: 'Run', start_date_local: activity.start_date_local }]
          : []),
        { id: 'ride', type: 'Ride' },
      ]);
    if (url.pathname.endsWith('/wellness'))
      return Response.json([{ id: '2026-09-20', hrv: distance / 1000, ctl: 10, atl: 12 }]);
    return failDetail
      ? new Response('', { status: 404 })
      : Response.json({
          ...activity,
          distance,
          icu_intervals: emptyDetail ? [] : activity.icu_intervals,
        });
  };
  try {
    for (const value of [5000, 6000]) {
      distance = value;
      const run = await beginSync(
        t.store,
        { mode: 'range', start: value === 5000 ? '2026-09-20' : '2026-09-19', end: '2026-09-21' },
        t.config.timezone,
      );
      assert.equal(
        (await executeSync(t.store, t.config, run.id, { fetch: fakeFetch })).status,
        'completed',
      );
    }
    assert.equal(calls, 6);
    const overlap = { start: '2026-09-19', end: '2026-09-21' };
    assert.equal((await t.store.listRuns(overlap)).total, 1);
    const wellness = await t.store.listWellness(overlap);
    assert.equal(wellness.total, 1);
    assert.equal(wellness.items[0].hrv_ms, 6);
    const saved = await t.store.getRun('i123');
    assert.equal(saved?.run.distance_m, 6000);
    assert.equal(saved?.run.avg_power_w, 220);
    assert.equal(saved?.run.elevation_loss_m, 65);
    assert.equal(saved?.intervals.length, 2);
    assert.equal(saved?.intervals[0].avg_power_w, 250);
    assert.equal(saved?.intervals[0].max_power_w, 400);
    assert.equal(saved?.intervals[1].avg_power_w, 0);
    assert.equal(saved?.intervals[1].max_power_w, 0);
    assert.equal(
      (await t.store.listWellness({ start: '2026-09-20', end: '2026-09-20' })).items[0].form_tsb,
      -2,
    );
    failDetail = true;
    const run = await beginSync(
      t.store,
      { mode: 'range', start: '2026-09-20', end: '2026-09-20' },
      t.config.timezone,
    );
    const failed = await executeSync(t.store, t.config, run.id, { fetch: fakeFetch });
    assert.equal(failed.status, 'partial');
    assert.equal(failed.rejected, 2);
    assert.deepEqual(await t.store.getRun('i123'), saved);
    assert.equal(await t.store.getRun('new-run'), null);
    assert.deepEqual(
      (await t.store.issues(run.id)).map((issue) => issue.code),
      ['DETAIL_UNAVAILABLE', 'DETAIL_UNAVAILABLE'],
    );
    failDetail = false;
    emptyDetail = true;
    const cleared = await beginSync(
      t.store,
      { mode: 'range', start: '2026-09-20', end: '2026-09-20' },
      t.config.timezone,
    );
    assert.equal(
      (await executeSync(t.store, t.config, cleared.id, { fetch: fakeFetch })).status,
      'completed',
    );
    assert.equal((await t.store.getRun('i123'))?.intervals.length, 0);
  } finally {
    await t.close();
  }
});

test('summaries distinguish missing from zero and export only normalized records', async () => {
  const t = await setup();
  const range = { start: '2026-09-20', end: '2026-09-20' };
  try {
    assert.equal((await summarizeRuns(t.store, range)).values.distance_m.value, null);
    const sync = await beginSync(t.store, { mode: 'range', ...range }, t.config.timezone);
    await executeSync(t.store, t.config, sync.id, { fetch: async () => Response.json([]) });
    assert.equal((await summarizeRuns(t.store, range)).values.distance_m.value, 0);
    await t.store.saveRun(mapActivity(activity, true).run, mapActivity(activity, true).intervals);
    await t.store.saveWellness(mapWellness({ id: range.start, restingHR: null }));
    const summary = await summarizeRuns(t.store, range);
    assert.equal(summary.values.pace_s_per_km.value, 360);
    assert.equal((await summarizeHealth(t.store, range, 'resting_hr_bpm')).mean, null);
    const destination = join(t.dir, 'export');
    await exportData(t.store, destination);
    const exported = await readFile(join(destination, 'records.json'), 'utf8');
    assert.equal(exported.includes('source_json'), false);
    assert.equal(exported.includes('snapshot'), false);
    const records = JSON.parse(exported);
    assert.equal(Object.hasOwn(records.runs[0], 'max_power_w'), false);
    assert.equal(Object.hasOwn(records.intervals[0], 'elevation_loss_m'), false);
  } finally {
    await t.close();
  }
});

test('upstream retries and redacts failures', async () => {
  let attempts = 0;
  const client = new IntervalsClient({
    apiKey: 'secret',
    athleteId: '0',
    sleep: async () => {},
    fetch: async () =>
      ++attempts === 1
        ? new Response('private upstream body', { status: 429, headers: { 'Retry-After': '1' } })
        : Response.json([]),
  });
  assert.deepEqual(await client.wellness('2026-09-20', '2026-09-20'), []);
  assert.equal(attempts, 2);
  await assert.rejects(
    new IntervalsClient({
      apiKey: 'secret',
      athleteId: '0',
      fetch: async () => new Response('sensitive body', { status: 401 }),
    }).get('/x'),
    /HTTP_401/,
  );
});

test('wiki facts preserve provenance and require confirmation for conflicts', async () => {
  const t = await setup();
  const wiki = new Wiki(t.config.wikiPath);
  try {
    await wiki.record({
      page: 'goals',
      key: 'race',
      value: '10 km',
      source: 'User statement',
      expected_revision: null,
    });
    const page = await wiki.read('goals');
    const conflict = await wiki.record({
      page: 'goals',
      key: 'race',
      value: 'Half marathon',
      source: 'User correction',
      expected_revision: page.revision,
    });
    assert.equal(conflict.status, 'confirmation_required');
    if (conflict.status !== 'confirmation_required') throw new Error('Expected proposal');
    await wiki.confirm(conflict.proposal.id, 'Yes, change my goal');
    assert.equal((await wiki.read('goals')).facts[0].value, 'Half marathon');
    await writeFile(join(t.config.wikiPath, 'zones.md'), 'invalid manual edit');
    assert.ok((await wiki.context()).pages.find((p) => p.page === 'zones')?.warning);
  } finally {
    await t.close();
  }
});

test('upstream cancellation interrupts rate-limit backoff without another request', async () => {
  const controller = new AbortController();
  let calls = 0;
  const client = new IntervalsClient({
    apiKey: 'synthetic',
    athleteId: '0',
    signal: controller.signal,
    fetch: async () => {
      calls++;
      setImmediate(() => controller.abort());
      return new Response(null, { status: 429, headers: { 'Retry-After': '30' } });
    },
  });
  await assert.rejects(client.activities('2026-09-20', '2026-09-20'), { name: 'AbortError' });
  assert.equal(calls, 1);
});
