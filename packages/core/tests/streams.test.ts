import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MAX_RUN_SAMPLES } from '@hub/contracts';
import { Store } from '@hub/db';
import {
  beginSync,
  executeSync,
  exportData,
  loadConfig,
  mapActivity,
  mapRunStreams,
} from '../src/index.ts';

const streams = [
  { type: 'time', data: [0, 1, 5] },
  { type: 'distance', data: [0, 2.5, 12] },
  { type: 'velocity_smooth', data: [0, 2.5, null] },
  { type: 'heartrate', data: [100, null, 140] },
  { type: 'watts', data: [0, 200, 240] },
  { type: 'raw_watts', data: [0, 200, 900] },
  { type: 'altitude', data: [-10, -9, -8] },
  { type: 'fixed_altitude', data: [-11, -10, -9] },
  { type: 'cadence', data: [0, 80, 85] },
  { type: 'latlng', data: ['discarded'] },
];
const activity = {
  id: 'synthetic',
  type: 'Run',
  start_date_local: '2026-09-20T08:00:00',
  distance: 12,
  power_field: 'power',
  icu_intervals: [
    {
      type: 'WORK',
      label: 'Repeat 1',
      start_index: 0,
      end_index: 3,
      start_time: 0,
      end_time: 6,
      moving_time: 5,
      elapsed_time: 6,
    },
  ],
};

test('streams retain aligned samples, gaps, zeros, missing values, signed altitude, and source identities', () => {
  const samples = mapRunStreams(activity.id, streams);
  assert.deepEqual(
    samples.map((s) => s.elapsed_s),
    [0, 1, 5],
  );
  assert.equal(samples[0].power_w, 0);
  assert.equal(samples[0].altitude_m, -10);
  assert.equal(samples[2].corrected_altitude_m, -9);
  assert.equal(samples[1].hr_bpm, null);
  assert.equal(samples[2].speed_mps, null);
  assert.equal(samples[2].power_w, 240);
  assert.equal(samples[2].raw_power_w, 900);
  assert.equal(samples[2].cadence_rpm, 85);
  assert.equal(JSON.stringify(samples).includes('latlng'), false);
  const sparse = mapRunStreams(activity.id, [
    streams[0],
    { type: 'heartrate', data: null, allNull: true },
  ]);
  assert.ok(sparse.every((s) => s.hr_bpm === null && s.power_w === null));
  assert.ok(
    mapRunStreams(activity.id, [streams[0], { type: 'heartrate', data: [], allNull: true }]).every(
      (s) => s.hr_bpm === null,
    ),
  );
  assert.deepEqual(mapRunStreams(activity.id, []), []);
  assert.deepEqual(mapRunStreams(activity.id, [{ type: 'time', data: [] }]), []);
  const mapped = mapActivity(activity, true);
  assert.equal(mapped.run.power_source, 'power');
  assert.equal(mapped.intervals?.[0].end_index, 3);
  assert.equal(mapped.intervals?.[0].end_time_s, 6);
  assert.equal(mapped.intervals?.[0].moving_time_s, 5);
  assert.equal(mapped.intervals?.[0].label, 'Repeat 1');
});

test('invalid alignment, timestamps, negative measurements, duplicates, and oversized streams are rejected', () => {
  const bad = [
    [streams[1]],
    [streams[0], { type: 'heartrate', data: [100] }],
    [streams[0], streams[0]],
    [{ type: 'time', data: [1, 0] }],
    [{ type: 'time', data: [0, null] }],
    [{ type: 'time', data: [0, Number.NaN] }],
    [streams[0], { type: 'watts', data: [0, -1, 200] }],
    [{ type: 'time', data: Array(MAX_RUN_SAMPLES + 1).fill(0) }],
  ];
  for (const source of bad) assert.throws(() => mapRunStreams(activity.id, source));
});

test('manual sync replaces samples atomically, preserves records after stream failures, and exports normalized samples', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-streams-'));
  const store = new Store(':memory:');
  await store.migrate();
  const config = loadConfig({ INTERVALS_API_KEY: 'synthetic' });
  let mode: 'valid' | 'edited' | 'failed' | 'invalid' | 'empty' = 'valid';
  let streamRequests = 0;
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/activities')) return Response.json([activity]);
    if (url.pathname.endsWith('/wellness')) return Response.json([]);
    if (url.pathname.endsWith('/streams.json')) {
      streamRequests++;
      assert.equal(url.searchParams.get('includeDefaults'), 'false');
      assert.equal(url.searchParams.get('types')?.includes('latlng'), false);
      assert.ok(url.searchParams.get('types')?.includes('raw_watts'));
      if (mode === 'failed') return new Response('', { status: 404 });
      if (mode === 'invalid')
        return Response.json([streams[0], { type: 'heartrate', data: [100] }]);
      return Response.json(
        mode === 'empty'
          ? []
          : streams.map((s) =>
              s.type === 'heartrate' && mode === 'edited' ? { ...s, data: [110, 120, 150] } : s,
            ),
      );
    }
    return Response.json({
      ...activity,
      distance: mode === 'failed' || mode === 'invalid' ? 99 : 12,
    });
  };
  const sync = async () => {
    const run = await beginSync(
      store,
      { mode: 'range', start: '2026-09-20', end: '2026-09-20' },
      config.timezone,
    );
    return executeSync(store, config, run.id, { fetch });
  };
  try {
    assert.equal((await sync()).status, 'completed');
    assert.equal((await store.getRunSamples(activity.id))?.total, 3);
    mode = 'edited';
    assert.equal((await sync()).status, 'completed');
    const saved = await store.getRun(activity.id);
    const savedSamples = await store.getRunSamples(activity.id);
    assert.equal(savedSamples?.items[1].hr_bpm, 120);
    assert.equal(savedSamples?.synced_at, saved?.run.synced_at);
    for (const failure of ['failed', 'invalid'] as const) {
      mode = failure;
      const result = await sync();
      assert.equal(result.status, 'failed');
      assert.equal(result.upserted, 0);
      assert.equal((await store.issues(result.id))[0].code, 'STREAMS_UNAVAILABLE');
      assert.deepEqual(await store.getRun(activity.id), saved);
      assert.deepEqual(await store.getRunSamples(activity.id), savedSamples);
    }
    await exportData(store, join(dir, 'export'));
    const records = JSON.parse(await readFile(join(dir, 'export/records.json'), 'utf8'));
    assert.equal(records.samples.length, 3);
    assert.equal(records.samples[2].raw_power_w, 900);
    assert.equal(JSON.stringify(records).includes('discarded'), false);
    mode = 'empty';
    assert.equal((await sync()).status, 'completed');
    assert.equal((await store.getRunSamples(activity.id))?.total, 0);
    assert.ok((await store.getRunSamples(activity.id))?.synced_at);
    assert.equal(streamRequests, 5);
  } finally {
    await store.close();
    await rm(dir, { recursive: true });
  }
});

test('cancelling stream retrieval preserves the previous import and releases the writer lease', async () => {
  const store = new Store(':memory:');
  await store.migrate();
  const controller = new AbortController();
  const config = loadConfig({ INTERVALS_API_KEY: 'synthetic' });
  const mapped = mapActivity(activity, true);
  try {
    await store.saveRun(mapped.run, mapped.intervals, mapRunStreams(activity.id, streams));
    const before = await store.getRun(activity.id);
    const beforeSamples = await store.getRunSamples(activity.id);
    const run = await beginSync(
      store,
      { mode: 'range', start: '2026-09-20', end: '2026-09-20' },
      config.timezone,
    );
    const result = await executeSync(store, config, run.id, {
      signal: controller.signal,
      fetch: async (input, options) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/activities')) return Response.json([activity]);
        if (url.pathname.endsWith('/streams.json')) {
          controller.abort();
          options?.signal?.throwIfAborted();
        }
        return Response.json({ ...activity, distance: 99 });
      },
    });
    assert.equal(result.status, 'interrupted');
    assert.deepEqual(await store.getRun(activity.id), before);
    assert.deepEqual(await store.getRunSamples(activity.id), beforeSamples);
    assert.equal(await store.acquireLease('next'), true);
    await store.releaseLease('next');
  } finally {
    await store.close();
  }
});
