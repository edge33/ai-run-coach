import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Store } from '@hub/db';
import {
  beginSync,
  executeSync,
  loadConfig,
  summarizeHealth,
  summarizeRuns,
} from '../src/index.ts';

const range = { start: '2026-09-20', end: '2026-09-20' };

for (const resource of ['runs', 'health'] as const) {
  test(`${resource} summary keeps measurements and coverage together during concurrent publication`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hub-summary-snapshot-'));
    const config = loadConfig({
      SQLITE_PATH: join(directory, 'synthetic.sqlite'),
      INTERVALS_API_KEY: 'synthetic',
    });
    const reader = new Store(config.databasePath);
    await reader.migrate();
    const writer = new Store(config.databasePath);
    const publish = async (distance: number, restingHR: number) => {
      const run = await beginSync(writer, { mode: 'range', ...range }, config.timezone);
      const activity = {
        id: 'synthetic-run',
        type: 'Run',
        start_date_local: `${range.start}T08:00:00`,
        distance,
        moving_time: 1800,
        total_elevation_gain: 20,
        icu_training_load: 30,
        icu_intervals: [],
      };
      const result = await executeSync(writer, config, run.id, {
        fetch: async (input) => {
          const path = new URL(String(input)).pathname;
          if (path.endsWith('/activities')) return Response.json([activity]);
          if (path.endsWith('/wellness')) return Response.json([{ id: range.start, restingHR }]);
          if (path.endsWith('/streams.json')) return Response.json([]);
          return Response.json(activity);
        },
      });
      assert.equal(result.status, 'completed');
      return result.id;
    };
    try {
      const previousId = await publish(5000, 50);
      let latestId: string | undefined;
      // Publish from a separate WAL connection after the first SELECT has read its rows,
      // before the summary can query coverage. This reproduces the actual commit boundary.
      Object.defineProperty(reader, 'db', {
        value: reader.db.withPlugin({
          transformQuery: ({ node }) => node,
          transformResult: async ({ result }) => {
            if (!latestId) latestId = await publish(10000, 60);
            return result;
          },
        }),
      });
      const readSummary = async () =>
        resource === 'runs'
          ? summarizeRuns(reader, range)
          : summarizeHealth(reader, range, 'resting_hr_bpm');
      const summary = await readSummary();
      assert.ok(latestId);
      assert.notEqual(latestId, previousId);
      assert.equal(summary.sample_size, 1);
      assert.deepEqual(summary.warnings, []);
      assert.ok(summary.coverage.every((row) => row.run_id === previousId));
      if ('values' in summary) assert.equal(summary.values.distance_m.value, 5000);
      else assert.equal(summary.mean, 50);

      const next = await readSummary();
      assert.ok(next.coverage.every((row) => row.run_id === latestId));
      if ('values' in next) assert.equal(next.values.distance_m.value, 10000);
      else assert.equal(next.mean, 60);
    } finally {
      await writer.close();
      await reader.close();
      await rm(directory, { recursive: true });
    }
  });
}
