import assert from 'node:assert/strict';
import test from 'node:test';
import { Store } from '@hub/db';
import { GarminClient } from '../src/garmin/client.ts';
import { GarminContractError } from '../src/garmin/errors.ts';
import { fetchGarminWellnessRange } from '../src/garmin/import.ts';
import { beginSync, executeSync, loadConfig } from '../src/index.ts';
import { garminFetch } from './fixtures.ts';

const range = { start: '2026-09-20', end: '2026-09-22' };

test('bulk wellness joins by source date and preserves gaps and zero', async () => {
  const paths: string[] = [];
  const base = garminFetch({ empty: true, restingHR: 0 });
  const client = new GarminClient('synthetic', {
    requestIntervalMs: 0,
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      if (path.includes('/sleep/'))
        return Response.json([
          { calendarDate: range.end, sleepTimeSeconds: 26000 },
          { calendarDate: null, sleepTimeSeconds: null },
          { calendarDate: range.start, sleepTimeSeconds: 0 },
          { calendarDate: null, sleepTimeSeconds: 0 },
        ]);
      if (path.includes('/hrv/daily/'))
        return Response.json({
          hrvSummaries: [{ calendarDate: range.start, lastNightAvg: 0, weeklyAvg: 99 }],
        });
      assert.ok(!path.includes('/usersummary/daily'));
      return base(input, init);
    },
  });
  const rows = await fetchGarminWellnessRange(client, range, { dailyWeightSummaries: [] });
  assert.deepEqual(
    rows.map((row) => row.date),
    [range.start, '2026-09-21', range.end],
  );
  assert.deepEqual(
    rows.map((row) => row.sleep_duration_s),
    [0, null, 26000],
  );
  assert.deepEqual(
    rows.map((row) => row.hrv_ms),
    [0, null, null],
  );
  assert.deepEqual(
    rows.map((row) => row.resting_hr_bpm),
    [0, 0, 0],
  );
  assert.equal(paths.filter((path) => path.includes('/sleep/')).length, 1);
  assert.equal(paths.filter((path) => path.includes('/hrv/')).length, 1);
  assert.equal(paths.filter((path) => path.includes('/v2/dailysummaries')).length, 1);
  assert.equal(paths.filter((path) => path.includes('/usersummary/daily')).length, 0);
});

test('bulk wellness rejects duplicate, out-of-range and undated records before fetching daily summaries', async () => {
  for (const endpoint of ['sleep', 'hrv', 'daily']) {
    for (const dates of [[range.start, range.start], ['2026-09-19'], [undefined]]) {
      let dailyRequests = 0;
      const base = garminFetch({ empty: true });
      const client = new GarminClient('synthetic', {
        requestIntervalMs: 0,
        fetch: async (input, init) => {
          const path = new URL(String(input)).pathname;
          if (path.includes('/v2/dailysummaries')) dailyRequests++;
          if (path.includes('/sleep/') && endpoint === 'sleep')
            return Response.json(
              dates.map((calendarDate) => ({ calendarDate, sleepTimeSeconds: 100 })),
            );
          if (path.includes('/hrv/daily/') && endpoint === 'hrv')
            return Response.json({
              hrvSummaries: dates.map((calendarDate) => ({ calendarDate, lastNightAvg: 40 })),
            });
          if (path.includes('/v2/dailysummaries') && endpoint === 'daily')
            return Response.json({
              data: dates.map((calendarDate) => ({
                calendarDate,
                heartRate: { restingValue: 50 },
              })),
            });
          return base(input, init);
        },
      });
      await assert.rejects(
        fetchGarminWellnessRange(client, range, { dailyWeightSummaries: [] }),
        /DUPLICATE_WELLNESS_DATE|WELLNESS_DATE_MISMATCH|GARMIN_CONTRACT_CHANGED/,
      );
      assert.equal(dailyRequests, endpoint === 'daily' ? 1 : 0);
    }
  }
});

test('73-day imports use three range requests per wellness resource without daily requests', async () => {
  const store = new Store(':memory:');
  await store.initialize();
  const config = loadConfig({ GARMIN_API_KEY: 'synthetic', GARMIN_REQUEST_INTERVAL_MS: '0' });
  const base = garminFetch({ empty: true });
  const paths: string[] = [];
  try {
    const run = await beginSync(
      store,
      { mode: 'range', start: '2026-09-01', end: '2026-11-12' },
      config.timezone,
    );
    const result = await executeSync(store, config, run.id, {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        paths.push(url.pathname);
        return base(input, init);
      },
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.upserted, 73);
    assert.equal(paths.filter((path) => path.includes('/sleep/')).length, 3);
    assert.equal(paths.filter((path) => path.includes('/hrv/')).length, 3);
    assert.equal(paths.filter((path) => path.includes('/v2/dailysummaries')).length, 3);
    assert.equal(paths.filter((path) => path.includes('/usersummary/daily')).length, 0);
    assert.equal(result.requests, 16); // Includes token, three empty activity pages and three weight calls.
  } finally {
    await store.close();
  }
});

test('undated empty sleep placeholders leave each requested day unknown and never use array position', async () => {
  const base = garminFetch({ empty: true });
  const client = new GarminClient('synthetic', {
    requestIntervalMs: 0,
    fetch: async (input, init) => {
      if (String(input).includes('/sleep/'))
        return Response.json([
          { calendarDate: null, sleepTimeSeconds: 0 },
          { calendarDate: null, sleepTimeSeconds: null },
          { sleepTimeSeconds: 0 },
        ]);
      return base(input, init);
    },
  });
  const rows = await fetchGarminWellnessRange(client, range, { dailyWeightSummaries: [] });
  assert.deepEqual(
    rows.map((row) => row.sleep_duration_s),
    [null, null, null],
  );
  assert.deepEqual(
    rows.map((row) => row.resting_hr_bpm),
    [50, 50, 50],
  );
});

test('undated positive sleep fails with safe source-date diagnostics instead of discarding a measurement', async () => {
  const base = garminFetch({ empty: true });
  const client = new GarminClient('synthetic', {
    requestIntervalMs: 0,
    fetch: async (input, init) => {
      if (String(input).includes('/sleep/'))
        return Response.json([{ calendarDate: null, sleepTimeSeconds: 25000 }]);
      return base(input, init);
    },
  });
  await assert.rejects(
    fetchGarminWellnessRange(client, range, { dailyWeightSummaries: [] }),
    (error: unknown) => {
      assert.ok(error instanceof GarminContractError);
      assert.equal(error.contract, 'sleep_range');
      assert.deepEqual(error.issues, [
        { path: '0.calendarDate', code: 'invalid_type', expected: 'string', received: 'null' },
      ]);
      assert.ok(!JSON.stringify(error).includes('25000'));
      return true;
    },
  );
});

test('bulk daily summaries use Garmin restingValue as supplied and preserve missing nested readings', async () => {
  const base = garminFetch({ empty: true });
  const client = new GarminClient('synthetic', {
    requestIntervalMs: 0,
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      assert.ok(!path.includes('/usersummary/daily'));
      if (path.includes('/v2/dailysummaries'))
        return Response.json({
          data: [
            { calendarDate: range.end, heartRate: { restingValue: null, minValue: 30 } },
            { calendarDate: range.start, heartRate: { restingValue: 45, minValue: 25 } },
            { calendarDate: '2026-09-21', heartRate: { restingValue: 0 } },
          ],
        });
      return base(input, init);
    },
  });
  const rows = await fetchGarminWellnessRange(client, range, { dailyWeightSummaries: [] });
  assert.deepEqual(
    rows.map((row) => row.resting_hr_bpm),
    [45, 0, null],
  );
  for (const data of [
    [],
    [{ calendarDate: range.start }],
    [{ calendarDate: range.start, heartRate: null }],
  ]) {
    const client = new GarminClient('synthetic', {
      requestIntervalMs: 0,
      fetch: async (input, init) => {
        if (String(input).includes('/v2/dailysummaries')) return Response.json({ data });
        return base(input, init);
      },
    });
    const rows = await fetchGarminWellnessRange(client, range, { dailyWeightSummaries: [] });
    assert.deepEqual(
      rows.map((row) => row.resting_hr_bpm),
      [null, null, null],
    );
  }
});

test('bulk daily response contract rejects changed envelopes and nested measurement types', async () => {
  const base = garminFetch({ empty: true });
  for (const response of [
    { summaries: [] },
    { data: {} },
    { data: [{ calendarDate: range.start, heartRate: [] }] },
    { data: [{ calendarDate: range.start, heartRate: { restingValue: 'private value' } }] },
    { data: [{ calendarDate: range.start, heartRate: { restingValue: -1 } }] },
  ]) {
    const client = new GarminClient('synthetic', {
      requestIntervalMs: 0,
      fetch: async (input, init) => {
        if (String(input).includes('/v2/dailysummaries')) return Response.json(response);
        return base(input, init);
      },
    });
    await assert.rejects(
      fetchGarminWellnessRange(client, range, { dailyWeightSummaries: [] }),
      (error: unknown) => {
        assert.ok(error instanceof GarminContractError);
        assert.equal(error.contract, 'daily_range');
        assert.ok(!JSON.stringify(error).includes('private value'));
        return true;
      },
    );
  }
});
