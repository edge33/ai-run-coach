import { type Kysely, sql } from 'kysely';
import { Migrator } from 'kysely/migration';
import type { Database } from './schema.ts';

const schema = `
CREATE TABLE runs (
 id TEXT PRIMARY KEY, external_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, sport TEXT NOT NULL,
 start_utc TEXT, start_local TEXT NOT NULL, local_date TEXT NOT NULL, timezone TEXT NOT NULL,
 indoor INTEGER, distance_m REAL, moving_time_s REAL, elapsed_time_s REAL, elevation_m REAL,
 avg_hr_bpm REAL, max_hr_bpm REAL, avg_cadence REAL, avg_power_w REAL, training_load REAL,
 source_hash TEXT NOT NULL, snapshot_id TEXT NOT NULL, synced_at TEXT NOT NULL,
 details_status TEXT NOT NULL, source_json TEXT NOT NULL
);
CREATE INDEX runs_date_idx ON runs(local_date, id);
CREATE TABLE run_intervals (
 run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, interval_index INTEGER NOT NULL,
 label TEXT, distance_m REAL, moving_time_s REAL, elapsed_time_s REAL, avg_hr_bpm REAL,
 avg_power_w REAL, source_json TEXT NOT NULL, PRIMARY KEY(run_id, interval_index)
);
CREATE TABLE health_days (
 local_date TEXT PRIMARY KEY, source_json TEXT NOT NULL, source_hash TEXT NOT NULL,
 synced_at TEXT NOT NULL, snapshot_id TEXT NOT NULL
);
CREATE TABLE health_values (
 local_date TEXT NOT NULL REFERENCES health_days(local_date) ON DELETE CASCADE,
 metric TEXT NOT NULL, value REAL, unit TEXT NOT NULL, definition TEXT NOT NULL,
 synced_at TEXT NOT NULL, snapshot_id TEXT NOT NULL, PRIMARY KEY(local_date, metric)
);
CREATE TABLE sync_runs (
 id TEXT PRIMARY KEY, mode TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL,
 ranges_json TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT,
 received INTEGER NOT NULL, upserted INTEGER NOT NULL, rejected INTEGER NOT NULL,
 requests INTEGER NOT NULL, completed_windows INTEGER NOT NULL, total_windows INTEGER NOT NULL,
 error_code TEXT
);
CREATE TABLE coverage (
 resource TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, synced_at TEXT NOT NULL,
 run_id TEXT NOT NULL REFERENCES sync_runs(id), PRIMARY KEY(resource, start, end)
);
CREATE TABLE snapshots (
 id TEXT PRIMARY KEY, sync_id TEXT NOT NULL REFERENCES sync_runs(id), resource TEXT NOT NULL,
 path TEXT NOT NULL, hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE sync_issues (
 id TEXT PRIMARY KEY, sync_id TEXT NOT NULL REFERENCES sync_runs(id), resource TEXT NOT NULL,
 code TEXT NOT NULL, record_ref TEXT
);
CREATE TABLE leases (name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
`;

export async function migrate(db: Kysely<Database>) {
  const migrator = new Migrator({
    db,
    provider: {
      getMigrations: async () => ({
        '001_initial': {
          up: async (db: Kysely<unknown>) => {
            for (const statement of schema
              .split(';')
              .map((s) => s.trim())
              .filter(Boolean)) {
              await sql.raw(statement).execute(db);
            }
          },
        },
      }),
    },
  });
  const result = await migrator.migrateToLatest();
  if (result.error) throw result.error;
}
