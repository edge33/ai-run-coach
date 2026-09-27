import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { RunInterval } from '@hub/contracts';
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
    max_power_w: null,
    elevation_gain_m: null,
    elevation_loss_m: null,
    avg_cadence_rpm: null,
    training_load: null,
    synced_at: '2026-09-20T10:00:00Z',
    details_status: 'complete',
  };
}
function interval(): RunInterval {
  return {
    run_id: 'run-one',
    sequence: 0,
    interval_type: 'WORK',
    duration_s: 1900,
    distance_m: 5000,
    avg_speed_mps: null,
    max_speed_mps: null,
    avg_hr_bpm: null,
    max_hr_bpm: null,
    avg_power_w: null,
    max_power_w: null,
    elevation_gain_m: null,
    elevation_loss_m: null,
    avg_cadence_rpm: null,
  };
}

test('fresh migration is repeatable and enforces the minimal schema', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-db-'));
  const api = new Store(join(dir, 'coach.sqlite'));
  await api.migrate();
  await api.migrate();
  const mcp = new Store(join(dir, 'coach.sqlite'));
  try {
    const tables = api.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    assert(tables.some((table) => table.name === 'wellness'));
    assert(
      !tables.some((table) => ['health_days', 'health_values', 'snapshots'].includes(table.name)),
    );
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
    assert.equal(api.sqlite.pragma('journal_mode', { simple: true }), 'wal');
    assert.throws(() =>
      api.sqlite
        .prepare('INSERT INTO run_intervals (run_id, sequence) VALUES (?, ?)')
        .run('missing', 0),
    );
    assert.throws(() => api.sqlite.prepare('UPDATE wellness SET weight_kg = -1').run());
    assert.throws(() =>
      api.sqlite.prepare('INSERT INTO wellness (date, synced_at) VALUES (NULL, ?)').run('now'),
    );
    assert.throws(() =>
      api.sqlite
        .prepare(
          'INSERT INTO runs (id, start_time, synced_at, details_status) VALUES (NULL, ?, ?, ?)',
        )
        .run('2026-09-20T08:00:00', 'now', 'complete'),
    );
    assert.throws(() =>
      api.sqlite.prepare('UPDATE wellness SET weight_kg = ?').run('not-a-number'),
    );
    assert.throws(() =>
      api.sqlite
        .prepare('INSERT INTO run_intervals (run_id, sequence) VALUES (?, ?)')
        .run('run-one', 0.5),
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
