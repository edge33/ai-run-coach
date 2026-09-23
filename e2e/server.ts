import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { localToday, type SyncRequest } from '@hub/contracts';
import { beginSync, executeSync, loadConfig } from '@hub/core';
import { Store } from '@hub/db';
import { buildApp } from '../apps/api/src/app.ts';
import { SyncManager } from '../apps/api/src/manager.ts';

// This fixture server is test-only. Production never enables fake imports or test routes.
const dir = await mkdtemp(join(tmpdir(), 'hub-browser-'));
const config = loadConfig({
  SQLITE_PATH: join(dir, 'coach.sqlite'),
  SNAPSHOT_PATH: join(dir, 'snapshots'),
  WIKI_PATH: join(dir, 'wiki'),
  INTERVALS_API_KEY: 'fixture',
  APP_ORIGINS: 'http://127.0.0.1:5175,http://127.0.0.1:3100,http://127.0.0.1:8089',
});
const store = new Store(config.databasePath);
await store.migrate();
let upstreamCalls = 0;
let fail = false;
const today = localToday(config.timezone);
const activity = {
  id: 'fixture-run',
  type: 'Run',
  name: 'Morning in the park',
  start_date_local: `${today}T08:00:00`,
  distance: 6000,
  moving_time: 2100,
  average_heartrate: 142,
  total_elevation_gain: 35,
  icu_intervals: [{ label: 'Steady run', distance: 6000, moving_time: 2100 }],
};
class FixtureManager extends SyncManager {
  tasks = new Set<Promise<unknown>>();
  override async start(request: SyncRequest) {
    const run = await beginSync(store, request, config.timezone);
    const task = executeSync(store, config, run.id, {
      fetch: async (url) => {
        upstreamCalls++;
        await delay(150);
        if (fail) return new Response('unavailable', { status: 401 });
        return Response.json(
          String(url).includes('/wellness')
            ? [{ id: today, restingHR: 52, hrv: 45, sleepSecs: 27000 }]
            : String(url).includes('/activities?')
              ? [activity]
              : activity,
        );
      },
      progress: (progress) => this.events.emit(run.id, progress),
    });
    this.tasks.add(task);
    void task.finally(() => this.tasks.delete(task));
    return run;
  }
  override async close() {
    await Promise.allSettled(this.tasks);
    await super.close();
  }
}
const app = buildApp(store, config, new FixtureManager(store, config));
app.get('/api/test/calls', async () => ({ count: upstreamCalls }));
app.post('/api/test/fail', async () => {
  fail = true;
  return { ok: true };
});
await app.listen({ host: '127.0.0.1', port: 3100 });
let closing = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    if (closing) return;
    closing = true;
    void app
      .close()
      .then(() => store.close())
      .then(() => rm(dir, { recursive: true }));
  });
