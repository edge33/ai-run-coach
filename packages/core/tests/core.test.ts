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
  loadConfig,
  summarizeHealth,
  summarizeRuns,
  Wiki,
} from '../src/index.ts';
import { garminFetch, syntheticRun, syntheticWellness } from './fixtures.ts';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'hub-core-'));
  const config = loadConfig({
    SQLITE_PATH: join(dir, 'db.sqlite'),
    WIKI_PATH: join(dir, 'wiki'),
    GARMIN_API_KEY: 'synthetic',
    GARMIN_REQUEST_INTERVAL_MS: '0',
  });
  const store = new Store(config.databasePath);
  await store.initialize();
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
});

test('sync rejects invalid and history-derived requests before acquiring a lease', async () => {
  const t = await setup();
  try {
    for (const request of [
      { mode: 'all' },
      { mode: 'recent' },
      { mode: 'range', start: '2026-09-22', end: '2026-09-20' },
      { mode: 'range', start: '2026-01-01', end: '2026-04-01' },
      { mode: 'range', start: '9999-01-01', end: '9999-01-02' },
    ])
      await assert.rejects(
        beginSync(t.store, request as Parameters<typeof beginSync>[1], t.config.timezone),
      );
    assert.equal(await t.store.activeSync(), null);
    assert.equal((await t.store.syncHistory()).length, 0);
  } finally {
    await t.close();
  }
});

test('summaries distinguish missing from zero; normalized exports contain Garmin laps, splits and no load fields', async () => {
  const t = await setup();
  const range = { start: '2026-09-20', end: '2026-09-20' };
  try {
    assert.equal((await summarizeRuns(t.store, range)).values.distance_m.value, null);
    const sync = await beginSync(t.store, { mode: 'range', ...range }, t.config.timezone);
    assert.equal(
      (await executeSync(t.store, t.config, sync.id, { fetch: garminFetch({ empty: true }) }))
        .status,
      'completed',
    );
    assert.equal((await summarizeRuns(t.store, range)).values.distance_m.value, 0);
    await t.store.saveRun(syntheticRun(), [], [], []);
    await t.store.saveWellness(syntheticWellness());
    assert.equal((await summarizeRuns(t.store, range)).values.pace_s_per_km.value, 360);
    assert.equal((await summarizeHealth(t.store, range, 'resting_hr_bpm')).mean, null);
    await exportData(t.store, join(t.dir, 'export'));
    const exported = JSON.parse(await readFile(join(t.dir, 'export/records.json'), 'utf8'));
    assert.equal(exported.source, 'garmin_connect');
    assert.deepEqual(exported.laps, []);
    assert.deepEqual(exported.splits, []);
    for (const field of [
      'intervals',
      'source_json',
      'training_load',
      'fitness_ctl',
      'raw_power_w',
    ]) {
      assert.ok(!JSON.stringify(exported).includes(`"${field}"`));
    }
  } finally {
    await t.close();
  }
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
