import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { addDays, localToday, validateRange } from '@hub/contracts';
import { Store } from '@hub/db';
import {
  backup,
  beginSync,
  executeSync,
  IntervalsClient,
  loadConfig,
  mapActivity,
  mapWellness,
  restore,
  summarizeHealth,
  summarizeRuns,
  Wiki,
} from '../src/index.ts';

const activity = {
  id: 'i123',
  type: 'Run',
  name: 'Synthetic run',
  start_date_local: '2026-09-20T08:00:00',
  start_date: '2026-09-20T06:00:00Z',
  distance: 5000,
  moving_time: 1800,
  elapsed_time: 1900,
  icu_intervals: [{ label: 'Run', distance: 5000, moving_time: 1800 }],
};
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'hub-core-'));
  const config = loadConfig({
    SQLITE_PATH: join(dir, 'db.sqlite'),
    SNAPSHOT_PATH: join(dir, 'snapshots'),
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
test('dates are validated; Rome local days handle DST independently of UTC', () => {
  assert.equal(localToday('Europe/Rome', new Date('2026-03-28T23:30:00Z')), '2026-03-29');
  assert.equal(localToday('Europe/Rome', new Date('2026-10-25T23:30:00Z')), '2026-10-26');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30');
  assert.throws(() => validateRange({ start: '2026-02-30', end: '2026-03-01' }));
  assert.throws(() => validateRange({ start: '2026-09-22', end: '2026-09-20' }));
  assert.equal(
    mapActivity({ ...activity, start_date: '2026-09-20T08:00:00' }, 's', 'Europe/Rome', true).run
      .start_utc,
    null,
  );
});
test('one-day sync is repeatable, filters other sports, captures edits, preserves nulls and source data', async () => {
  const t = await setup();
  let distance = 5000;
  let calls = 0;
  const fakeFetch: typeof fetch = async (input) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://intervals.icu');
    if (url.pathname.endsWith('/activities'))
      return Response.json([
        { ...activity, distance },
        { id: 'ride', type: 'Ride' },
      ]);
    if (url.pathname.endsWith('/wellness'))
      return Response.json([
        {
          id: '2026-09-20',
          restingHR: 51,
          hrv: 42,
          hrvSDNN: 60,
          sleepSecs: null,
          unknown_future_field: 123,
        },
      ]);
    return Response.json({ ...activity, distance });
  };
  try {
    for (const value of [5000, 6000]) {
      distance = value;
      const run = await beginSync(
        t.store,
        { mode: 'range', start: '2026-09-20', end: '2026-09-20' },
        t.config.timezone,
      );
      assert.equal(
        (await executeSync(t.store, t.config, run.id, { fetch: fakeFetch })).status,
        'completed',
      );
    }
    assert.equal(calls, 6);
    const runs = await t.store.listRuns({ start: '2026-09-20', end: '2026-09-20' });
    assert.equal(runs.total, 1);
    assert.equal(runs.items[0].distance_m, 6000);
    assert.equal(runs.items[0].avg_hr_bpm, null);
    const source = await t.store.db
      .selectFrom('health_days')
      .select('source_json')
      .executeTakeFirstOrThrow();
    assert.equal(JSON.parse(source.source_json).unknown_future_field, 123);
    const summary = await summarizeRuns(t.store, { start: '2026-09-20', end: '2026-09-20' });
    assert.equal(summary.values.pace_s_per_km.value, 300);
    assert.equal(summary.values.training_load.value, null);
    const hrv = await summarizeHealth(t.store, { start: '2026-09-20', end: '2026-09-20' }, 'hrv');
    assert.equal(hrv.mean, 42);
    assert.equal(hrv.sample_size, 1);
  } finally {
    await t.close();
  }
});
test('partial and empty responses never delete previous records or claim complete new coverage', async () => {
  const t = await setup();
  try {
    const mapped = mapActivity(activity, 's', 'Europe/Rome', true);
    await t.store.saveRun(mapped.run, mapped.intervals);
    const run = await beginSync(
      t.store,
      { mode: 'range', start: '2026-09-20', end: '2026-09-20' },
      t.config.timezone,
    );
    const result = await executeSync(t.store, t.config, run.id, {
      fetch: async (url) =>
        String(url).includes('wellness')
          ? Response.json([{ id: 'invalid-day' }])
          : Response.json([{}]),
    });
    assert.equal(result.status, 'failed');
    assert.equal((await t.store.counts()).run_count, 1);
    assert.equal((await t.store.coverage()).length, 0);
    const empty = await beginSync(
      t.store,
      { mode: 'range', start: '2026-09-20', end: '2026-09-20' },
      t.config.timezone,
    );
    await executeSync(t.store, t.config, empty.id, { fetch: async () => Response.json([]) });
    assert.equal((await t.store.counts()).run_count, 1);
  } finally {
    await t.close();
  }
});
test('summaries distinguish unknown from zero and use paired pace denominators', async () => {
  const t = await setup();
  const range = { start: '2026-09-20', end: '2026-09-20' };
  try {
    assert.equal((await summarizeRuns(t.store, range)).values.distance_m.value, null);
    const sync = await beginSync(t.store, { mode: 'range', ...range }, t.config.timezone);
    await executeSync(t.store, t.config, sync.id, { fetch: async () => Response.json([]) });
    assert.equal((await summarizeRuns(t.store, range)).values.distance_m.value, 0);
    for (const source of [
      activity,
      { ...activity, id: 'zero', distance: 0, moving_time: 300 },
      { ...activity, id: 'missing-time', distance: 2000, moving_time: null },
    ]) {
      const value = mapActivity(source, 's', 'Europe/Rome', true);
      await t.store.saveRun(value.run, value.intervals);
    }
    const summary = await summarizeRuns(t.store, range);
    assert.equal(summary.values.distance_m.value, 7000);
    assert.equal(summary.values.pace_s_per_km.value, 360);
    assert.equal(summary.values.pace_s_per_km.measured, 1);
    const health = mapWellness({ id: range.start, restingHR: null }, 's');
    await t.store.saveHealth(health.day, health.values);
    assert.equal((await summarizeHealth(t.store, range, 'resting_hr')).mean, null);
  } finally {
    await t.close();
  }
});
test('upstream reads honor Retry-After, redact failures, and reject malformed JSON', async () => {
  let attempts = 0;
  const waits: number[] = [];
  const client = new IntervalsClient({
    apiKey: 'secret',
    athleteId: '0',
    sleep: async (ms) => {
      waits.push(ms);
    },
    fetch: async (_input, options) => {
      assert.equal(
        new Headers(options?.headers).get('Authorization'),
        `Basic ${Buffer.from('API_KEY:secret').toString('base64')}`,
      );
      attempts++;
      return attempts === 1
        ? new Response('private upstream body', { status: 429, headers: { 'Retry-After': '1' } })
        : Response.json([]);
    },
  });
  assert.deepEqual(await client.wellness('2026-09-20', '2026-09-20'), []);
  assert.equal(waits[0], 1000);
  await assert.rejects(
    new IntervalsClient({
      apiKey: 'secret',
      athleteId: '0',
      fetch: async () => new Response('sensitive body', { status: 401 }),
    }).get('/x'),
    /HTTP_401/,
  );
  await assert.rejects(
    new IntervalsClient({
      apiKey: 'secret',
      athleteId: '0',
      fetch: async () => new Response('invalid'),
    }).get('/x'),
    /INVALID_JSON/,
  );
});
test('wiki facts preserve provenance; conflicts/inferences require confirmation; stale proposals fail', async () => {
  const t = await setup();
  const wiki = new Wiki(t.config.wikiPath);
  try {
    const first = await wiki.record({
      page: 'goals',
      key: 'race',
      value: '10 km',
      source: 'User: I want to run 10 km',
      expected_revision: null,
    });
    assert.equal(first.status, 'saved');
    const page = await wiki.read('goals');
    const conflict = await wiki.record({
      page: 'goals',
      key: 'race',
      value: 'Half marathon',
      source: 'User correction',
      expected_revision: page.revision,
    });
    assert.equal(conflict.status, 'confirmation_required');
    assert.equal((await wiki.read('goals')).facts[0].value, '10 km');
    if (conflict.status !== 'confirmation_required') throw new Error('Expected proposal');
    await wiki.confirm(conflict.proposal.id, 'Yes, change my goal');
    assert.equal((await wiki.read('goals')).facts[0].value, 'Half marathon');
    await assert.rejects(wiki.confirm(conflict.proposal.id, 'Apply it again'), /revision changed/);
    await assert.rejects(wiki.read('../../secret'));
    await writeFile(join(t.config.wikiPath, 'zones.md'), 'invalid manual edit');
    assert.ok((await wiki.context()).pages.find((p) => p.page === 'zones')?.warning);
    const proposal = await wiki.propose({
      page: 'preferences',
      key: 'surface',
      value: 'Trail',
      source: 'Interpretation from explicitly discussed preference',
      expected_revision: null,
    });
    assert.equal((await wiki.read('preferences')).revision, null);
    await wiki.confirm(proposal.proposal.id, 'Yes, trail is my preference');
    assert.equal((await wiki.read('preferences')).facts[0].status, 'confirmed_interpretation');
  } finally {
    await t.close();
  }
});
test('coordinated backup restores SQLite and wiki, preserves summaries, detects corruption', async () => {
  const t = await setup();
  try {
    const mapped = mapActivity(activity, 's', 'Europe/Rome', true);
    await t.store.saveRun(mapped.run, mapped.intervals);
    await new Wiki(t.config.wikiPath).record({
      page: 'background',
      key: 'experience',
      value: 'Starting a new notebook',
      source: 'Explicit user statement',
      expected_revision: null,
    });
    const destination = join(t.dir, 'backup');
    await backup(t.store, t.config, destination);
    const restoredPath = join(t.dir, 'restored');
    await restore(destination, restoredPath);
    const restored = new Store(join(restoredPath, 'coach.sqlite'));
    try {
      assert.deepEqual(
        await summarizeRuns(restored, { start: '2026-09-20', end: '2026-09-20' }),
        await summarizeRuns(t.store, { start: '2026-09-20', end: '2026-09-20' }),
      );
      assert.equal(
        (await new Wiki(join(restoredPath, 'wiki')).read('background')).facts[0].key,
        'experience',
      );
      assert.equal(await restored.acquireLease('after-restore'), true);
      await new Wiki(join(restoredPath, 'wiki')).record({
        page: 'preferences',
        key: 'surface',
        value: 'Road',
        source: 'Explicit restoration test fixture',
        expected_revision: null,
      });
    } finally {
      await restored.close();
    }
    await writeFile(
      join(destination, 'wiki/background.md'),
      `${await readFile(join(destination, 'wiki/background.md'), 'utf8')}changed`,
    );
    await assert.rejects(restore(destination, join(t.dir, 'bad')), /checksum mismatch/);
  } finally {
    await t.close();
  }
});
