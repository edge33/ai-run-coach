import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { type RunRow, Store } from '../src/index.ts';

function row(id = 'run-one'): RunRow {
  return {
    id,
    external_id: 'external-one',
    name: 'Morning run',
    sport: 'Run',
    start_utc: '2026-09-20T06:00:00Z',
    start_local: '2026-09-20T08:00:00',
    local_date: '2026-09-20',
    timezone: 'Europe/Rome',
    indoor: null,
    distance_m: 5000,
    moving_time_s: 1800,
    elapsed_time_s: 1900,
    elevation_m: null,
    avg_hr_bpm: null,
    max_hr_bpm: null,
    avg_cadence: null,
    avg_power_w: null,
    training_load: null,
    source_hash: 'hash',
    snapshot_id: 'snapshot',
    synced_at: '2026-09-20T10:00:00Z',
    details_status: 'complete',
    source_json: '{}',
  };
}
test('migrations are repeatable; API and MCP connections see the same WAL-backed records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-db-'));
  const api = new Store(join(dir, 'coach.sqlite'));
  await api.migrate();
  await api.migrate();
  const mcp = new Store(join(dir, 'coach.sqlite'));
  try {
    await api.saveRun(row(), []);
    await api.saveRun({ ...row('new-id'), distance_m: 6000 }, []);
    const result = await mcp.listRuns({ start: '2026-09-20', end: '2026-09-20' });
    assert.equal(result.total, 1);
    assert.equal(result.items[0].id, 'run-one');
    assert.equal(result.items[0].distance_m, 6000);
    assert.equal(result.items[0].avg_hr_bpm, null);
    assert.equal(api.sqlite.pragma('journal_mode', { simple: true }), 'wal');
  } finally {
    await api.close();
    await mcp.close();
    await rm(dir, { recursive: true });
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
test('a failed interval transaction rolls back the run and leaves previous intervals intact', async () => {
  const store = new Store(':memory:');
  await store.migrate();
  const interval = {
    run_id: 'run-one',
    interval_index: 0,
    label: 'Lap',
    distance_m: 5000,
    moving_time_s: 1800,
    elapsed_time_s: 1900,
    avg_hr_bpm: null,
    avg_power_w: null,
    source_json: '{}',
  };
  try {
    await store.saveRun(row(), [interval]);
    await assert.rejects(store.saveRun({ ...row(), distance_m: 9000 }, [interval, interval]));
    const result = await store.getRun('run-one');
    assert.equal(result?.run.distance_m, 5000);
    assert.equal(result?.intervals.length, 1);
    assert.throws(() =>
      store.sqlite
        .prepare('INSERT INTO run_intervals (run_id, interval_index, source_json) VALUES (?, ?, ?)')
        .run('missing', 0, '{}'),
    );
  } finally {
    await store.close();
  }
});
