import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { type RunInterval, runSampleSchema } from '@hub/contracts';
import { type RunRow, Store } from '../src/index.ts';

function run(id = 'run-one'): RunRow {
  return {
    id,
    start_time: '2026-09-20T08:00:00',
    indoor: null,
    distance_m: 5000,
    duration_s: 1900,
    moving_time_s: 1800,
    avg_speed_mps: null,
    max_speed_mps: null,
    avg_hr_bpm: null,
    max_hr_bpm: null,
    avg_power_w: null,
    elevation_gain_m: null,
    elevation_loss_m: null,
    avg_cadence_rpm: null,
    training_load: null,
    synced_at: '2026-09-20T10:00:00Z',
    details_status: 'complete',
    power_source: null,
    samples_synced_at: null,
  };
}
function interval(): RunInterval {
  return {
    run_id: 'run-one',
    sequence: 0,
    interval_type: 'WORK',
    label: null,
    start_index: null,
    end_index: null,
    start_time_s: null,
    end_time_s: null,
    moving_time_s: null,
    duration_s: 1900,
    distance_m: 5000,
    avg_speed_mps: null,
    max_speed_mps: null,
    avg_hr_bpm: null,
    max_hr_bpm: null,
    avg_power_w: null,
    max_power_w: null,
    elevation_gain_m: null,
    avg_cadence_rpm: null,
  };
}

test('run upserts preserve intervals and wellness values are shared between readers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-db-'));
  const api = new Store(join(dir, 'coach.sqlite'));
  await api.migrate();
  const mcp = new Store(join(dir, 'coach.sqlite'));
  try {
    await api.saveRun(run(), [interval()]);
    await api.saveRun({ ...run(), distance_m: 6000 }, null);
    const result = await mcp.listRuns({ start: '2026-09-20', end: '2026-09-20' });
    assert.equal(result.total, 1);
    assert.equal(result.items[0].distance_m, 6000);
    assert.equal((await mcp.getRun('run-one'))?.intervals.length, 1);
    await api.saveWellness({
      date: '2026-09-20',
      resting_hr_bpm: 0,
      hrv_ms: null,
      sleep_duration_s: null,
      weight_kg: null,
      fitness_ctl: 10,
      fatigue_atl: 12,
      form_tsb: -2,
      training_load: null,
      synced_at: '2026-09-20T10:00:00Z',
    });
    assert.equal(
      (await mcp.listWellness({ start: '2026-09-20', end: '2026-09-20' })).items[0].form_tsb,
      -2,
    );
    await assert.rejects(
      api.saveRun({ ...run('bad-date'), start_time: '2026-02-30T08:00:00' }, []),
    );
    assert.equal((await api.listRuns({ start: '2026-09-20', end: '2026-09-20' })).total, 1);
  } finally {
    await api.close();
    await mcp.close();
    await rm(dir, { recursive: true });
  }
});
test('maximum valid local date is included in run queries', async () => {
  const store = new Store(':memory:');
  await store.migrate();
  try {
    await store.saveRun({ ...run(), start_time: '9999-12-31T12:00:00' }, []);
    assert.equal((await store.listRuns({ start: '9999-12-31', end: '9999-12-31' })).total, 1);
  } finally {
    await store.close();
  }
});

test('leases exclude concurrent writers and cannot be released by another owner', async () => {
  const store = new Store(':memory:');
  await store.migrate();
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

test('failed interval replacement rolls back the run', async () => {
  const store = new Store(':memory:');
  await store.migrate();
  try {
    await store.saveRun(run(), [interval()]);
    await assert.rejects(store.saveRun({ ...run(), distance_m: 9000 }, [interval(), interval()]));
    const result = await store.getRun('run-one');
    assert.equal(result?.run.distance_m, 5000);
    assert.equal(result?.intervals.length, 1);
  } finally {
    await store.close();
  }
});

test('sample pages are bounded; sample failures roll back run, intervals and samples; deletion cascades', async () => {
  const store = new Store(':memory:');
  await store.migrate();
  const samples = Array.from({ length: 105 }, (_, index) =>
    runSampleSchema.parse({
      run_id: 'run-one',
      sample_index: index,
      elapsed_s: index * 2,
      distance_m: index * 5,
      speed_mps: 2.5,
      hr_bpm: index === 0 ? null : 140,
      power_w: 0,
      raw_power_w: null,
      altitude_m: -5,
      corrected_altitude_m: -4,
      cadence_rpm: 80,
    }),
  );
  try {
    await store.saveRun(run(), [{ ...interval(), start_index: 0, end_index: 105 }], samples);
    const first = await store.getRunSamples('run-one');
    const second = await store.getRunSamples('run-one', 100, 100);
    assert.equal(first?.items.length, 100);
    assert.equal(first?.total, 105);
    assert.deepEqual(
      second?.items.map((s) => s.sample_index),
      [100, 101, 102, 103, 104],
    );
    assert.equal(first?.synced_at, run().synced_at);
    assert.equal(await store.getRunSamples('unknown'), null);
    await assert.rejects(store.getRunSamples('run-one', 101));
    await assert.rejects(store.saveRun(run(), [interval()], [{ ...samples[0], run_id: 'other' }]));
    await assert.rejects(
      store.saveRun(run(), [{ ...interval(), start_index: 3, end_index: 1 }], samples),
    );
    await assert.rejects(store.saveRun(run(), [{ ...interval(), end_index: 106 }], samples));
    const saved = await store.getRun('run-one');
    store.sqlite.exec(`CREATE TRIGGER synthetic_sample_failure BEFORE INSERT ON run_samples
      WHEN NEW.sample_index = 51 BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`);
    await assert.rejects(store.saveRun({ ...run(), distance_m: 999 }, [], samples));
    assert.deepEqual(await store.getRun('run-one'), saved);
    assert.deepEqual(await store.getRunSamples('run-one'), first);
    store.sqlite.exec('DROP TRIGGER synthetic_sample_failure');
    await store.saveRun(run(), null);
    assert.equal((await store.getRunSamples('run-one'))?.synced_at, run().synced_at);
    store.sqlite.prepare('DELETE FROM runs WHERE id = ?').run('run-one');
    assert.equal((await store.db.selectFrom('run_samples').selectAll().execute()).length, 0);
    assert.deepEqual(store.sqlite.pragma('foreign_key_check'), []);
  } finally {
    await store.close();
  }
});
