import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { RunInterval } from '@hub/contracts';
import { Migrator } from 'kysely/migration';
import { type RunRow, Store } from '../src/index.ts';
import { initialMigration } from '../src/migrations/001_initial.ts';

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
    const runColumns = api.sqlite.pragma('table_info(runs)') as { name: string }[];
    const intervalColumns = api.sqlite.pragma('table_info(run_intervals)') as { name: string }[];
    assert.equal(
      runColumns.some((column) => column.name === 'max_power_w'),
      false,
    );
    assert.equal(
      intervalColumns.some((column) => column.name === 'elevation_loss_m'),
      false,
    );
    assert.ok(runColumns.some((column) => column.name === 'elevation_loss_m'));
    assert.ok(intervalColumns.some((column) => column.name === 'max_power_w'));
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

test('upgrade removes only unsupported columns and preserves records, indexes, strict tables, and foreign keys', async () => {
  const store = new Store(':memory:');
  try {
    const migrator = new Migrator({
      db: store.db,
      provider: { getMigrations: async () => ({ '001_initial': initialMigration }) },
    });
    const initial = await migrator.migrateToLatest();
    assert.ifError(initial.error);
    store.sqlite
      .prepare(`INSERT INTO runs
      (id, start_time, synced_at, details_status, avg_power_w, elevation_loss_m, max_power_w)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('run-one', '2026-09-20T08:00:00', '2026-09-20T10:00:00Z', 'complete', 220, 65, null);
    store.sqlite
      .prepare(`INSERT INTO run_intervals
      (run_id, sequence, avg_power_w, max_power_w, elevation_loss_m) VALUES (?, ?, ?, ?, ?)`)
      .run('run-one', 0, 250, 400, null);
    store.sqlite
      .prepare('INSERT INTO wellness (date, resting_hr_bpm, synced_at) VALUES (?, ?, ?)')
      .run('2026-09-20', 0, '2026-09-20T10:00:00Z');
    store.sqlite
      .prepare('INSERT INTO leases (name, owner, expires_at) VALUES (?, ?, ?)')
      .run('writer', 'synthetic-owner', 1000);
    const expectedRun = store.sqlite.prepare('SELECT * FROM runs').get() as Record<string, unknown>;
    const expectedInterval = store.sqlite.prepare('SELECT * FROM run_intervals').get() as Record<
      string,
      unknown
    >;
    const expectedWellness = store.sqlite.prepare('SELECT * FROM wellness').get();
    const expectedLease = store.sqlite.prepare('SELECT * FROM leases').get();
    delete expectedRun.max_power_w;
    delete expectedInterval.elevation_loss_m;

    await store.migrate();
    await store.migrate();

    const saved = await store.getRun('run-one');
    assert.deepEqual(saved?.run, expectedRun);
    assert.deepEqual(saved?.intervals, [expectedInterval]);
    assert.deepEqual(store.sqlite.prepare('SELECT * FROM wellness').get(), expectedWellness);
    assert.deepEqual(store.sqlite.prepare('SELECT * FROM leases').get(), expectedLease);
    assert.equal(store.sqlite.prepare('SELECT * FROM kysely_migration').all().length, 2);
    const indexes = store.sqlite.pragma('index_list(runs)') as { name: string }[];
    assert.ok(indexes.some((index) => index.name === 'runs_start_time_id_idx'));
    const tables = store.sqlite.pragma('table_list') as { name: string; strict: number }[];
    assert.equal(tables.find((table) => table.name === 'runs')?.strict, 1);
    assert.equal(tables.find((table) => table.name === 'run_intervals')?.strict, 1);
    assert.deepEqual(store.sqlite.pragma('foreign_key_check'), []);
    assert.throws(() =>
      store.sqlite
        .prepare('INSERT INTO run_intervals (run_id, sequence) VALUES (?, ?)')
        .run('missing', 0),
    );
    store.sqlite.prepare('DELETE FROM runs WHERE id = ?').run('run-one');
    assert.equal(store.sqlite.prepare('SELECT * FROM run_intervals').all().length, 0);
  } finally {
    await store.close();
  }
});
