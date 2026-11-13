import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { lapSchema, runSampleSchema, runSchema, splitSchema, wellnessSchema } from '@hub/contracts';
import { Store } from '../src/index.ts';

const run = () =>
  runSchema.parse({
    id: '123',
    start_time: '2026-09-20T08:00:00',
    distance_m: 5000,
    synced_at: '2026-09-20T10:00:00Z',
  });
const lap = () =>
  lapSchema.parse({
    run_id: '123',
    sequence: 0,
    start_time_s: 0,
    end_time_s: null,
    timing_warning: 'LAP_TIMESTAMP_NOT_END',
    duration_s: 100,
  });
const split = () =>
  splitSchema.parse({
    run_id: '123',
    sequence: 1,
    split_type: 'intervalActive',
    start_time_s: 0,
    end_time_s: 100,
    first_lap_index: 0,
    number_of_laps: 1,
  });

test('upserts preserve unchanged children and readers share normalized wellness including zero', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-db-'));
  const path = join(dir, 'db.sqlite');
  const writer = new Store(path);
  await writer.initialize();
  const reader = new Store(path);
  try {
    await writer.saveRun(run(), [lap()], [split()], []);
    await writer.saveRun({ ...run(), distance_m: 6000 }, null, null, null);
    const result = await reader.getRun('123');
    assert.equal(result?.run.distance_m, 6000);
    assert.equal(result?.laps.length, 1);
    assert.equal(result?.splits.length, 1);
    assert.equal(result?.laps[0].end_time_s, null);
    await writer.saveWellness(
      wellnessSchema.parse({ date: '2026-09-20', resting_hr_bpm: 0, synced_at: run().synced_at }),
    );
    assert.equal((await reader.listWellness()).items[0].resting_hr_bpm, 0);
    await assert.rejects(
      writer.saveRun({ ...run(), start_time: '2026-02-30T08:00:00' }, [], [], []),
    );
    assert.equal((await writer.listRuns()).total, 1);
  } finally {
    await reader.close();
    await writer.close();
    await rm(dir, { recursive: true });
  }
});

test('maximum local date is included in run queries', async () => {
  const store = new Store(':memory:');
  await store.initialize();
  try {
    await store.saveRun({ ...run(), start_time: '9999-12-31T12:00:00' }, [], [], []);
    assert.equal((await store.listRuns({ start: '9999-12-31', end: '9999-12-31' })).total, 1);
  } finally {
    await store.close();
  }
});

test('leases exclude competing writers and cannot be released by another owner', async () => {
  const store = new Store(':memory:');
  await store.initialize();
  try {
    assert.equal(await store.acquireLease('first', 1000, 1000), true);
    assert.equal(await store.acquireLease('second', 1100, 1000), false);
    await store.releaseLease('second');
    assert.equal(await store.acquireLease('second', 1200, 1000), false);
    assert.equal(await store.acquireLease('second', 2001, 1000), true);
    assert.equal(await store.renewLease('first', 2001), false);
  } finally {
    await store.close();
  }
});

test('invalid lap/split replacement leaves the prior complete run unchanged', async () => {
  const store = new Store(':memory:');
  await store.initialize();
  try {
    await store.saveRun(run(), [lap()], [split()], []);
    const before = await store.getRun('123');
    await assert.rejects(
      store.saveRun({ ...run(), distance_m: 999 }, [lap(), lap()], [split()], []),
    );
    await assert.rejects(store.saveRun(run(), [lap()], [{ ...split(), first_lap_index: 5 }], []));
    await assert.rejects(
      store.saveRun(run(), [lap()], [{ ...split(), start_time_s: 100, end_time_s: 0 }], []),
    );
    assert.deepEqual(await store.getRun('123'), before);
  } finally {
    await store.close();
  }
});

test('bounded sample pages are consistent and failed publication rolls back all children', async () => {
  const store = new Store(':memory:');
  await store.initialize();
  const samples = Array.from({ length: 105 }, (_, index) =>
    runSampleSchema.parse({
      run_id: '123',
      sample_index: index,
      elapsed_s: index * 2,
      power_w: 0,
      altitude_m: -5,
      cadence_spm: 160,
    }),
  );
  try {
    await store.saveRun(run(), [lap()], [split()], samples);
    const first = await store.getRunSamples('123');
    const second = await store.getRunSamples('123', 100, 100);
    assert.equal(first?.items.length, 100);
    assert.equal(first?.total, 105);
    assert.deepEqual(
      second?.items.map((s) => s.sample_index),
      [100, 101, 102, 103, 104],
    );
    assert.equal(first?.source, 'garmin_connect');
    assert.equal(first?.synced_at, run().synced_at);
    assert.equal(await store.getRunSamples('unknown'), null);
    await assert.rejects(store.getRunSamples('123', 101));
    await assert.rejects(store.saveRun(run(), [], [], [{ ...samples[0], run_id: 'other' }]));
    const saved = await store.getRun('123');
    store.sqlite.exec(
      "CREATE TRIGGER synthetic_failure BEFORE INSERT ON run_samples WHEN NEW.sample_index = 51 BEGIN SELECT RAISE(ABORT, 'synthetic'); END",
    );
    await assert.rejects(store.saveRun({ ...run(), distance_m: 999 }, [], [], samples));
    assert.deepEqual(await store.getRun('123'), saved);
    assert.deepEqual(await store.getRunSamples('123'), first);
    store.sqlite.exec('DROP TRIGGER synthetic_failure');
    await store.saveRun(run(), [], [], []);
    assert.equal((await store.getRun('123'))?.split_total, 0);
    assert.equal((await store.getRunSamples('123'))?.total, 0);
    await store.saveRun(run(), [lap()], [split()], samples);
    store.sqlite.prepare('DELETE FROM runs WHERE id = ?').run('123');
    assert.equal((await store.db.selectFrom('run_laps').selectAll().execute()).length, 0);
    assert.equal((await store.db.selectFrom('run_splits').selectAll().execute()).length, 0);
    assert.equal((await store.db.selectFrom('run_samples').selectAll().execute()).length, 0);
  } finally {
    await store.close();
  }
});
