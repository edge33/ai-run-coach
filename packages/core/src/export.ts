import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Store } from '@hub/db';

export async function exportData(store: Store, destination: string) {
  const path = resolve(destination);
  await mkdir(path, { recursive: true });
  if ((await readdir(path)).length) throw new Error('Destination must be empty');
  const records = await store.db.transaction().execute(async (tx) => ({
    runs: await tx.selectFrom('runs').selectAll().execute(),
    intervals: await tx.selectFrom('run_intervals').selectAll().execute(),
    samples: await tx.selectFrom('run_samples').selectAll().execute(),
    wellness: await tx.selectFrom('wellness').selectAll().execute(),
    sync_runs: await tx.selectFrom('sync_runs').selectAll().execute(),
    coverage: await tx.selectFrom('coverage').selectAll().execute(),
    sync_issues: await tx.selectFrom('sync_issues').selectAll().execute(),
  }));
  await writeFile(`${path}/records.json`, JSON.stringify(records, null, 2), { mode: 0o600 });
  return { destination: path, runs: records.runs.length, wellness_days: records.wellness.length };
}
