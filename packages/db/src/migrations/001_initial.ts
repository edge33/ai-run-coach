import { type Kysely, sql } from 'kysely';

const statements = [
  `CREATE TABLE wellness (
    date TEXT PRIMARY KEY,
    resting_hr_bpm REAL CHECK(resting_hr_bpm >= 0),
    hrv_ms REAL CHECK(hrv_ms >= 0),
    sleep_duration_s REAL CHECK(sleep_duration_s >= 0),
    weight_kg REAL CHECK(weight_kg >= 0),
    fitness_ctl REAL CHECK(fitness_ctl >= 0),
    fatigue_atl REAL CHECK(fatigue_atl >= 0),
    form_tsb REAL,
    training_load REAL CHECK(training_load >= 0),
    synced_at TEXT NOT NULL
  )`,
  `CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    start_time TEXT NOT NULL,
    indoor INTEGER CHECK(indoor IN (0, 1)),
    distance_m REAL CHECK(distance_m >= 0),
    duration_s REAL CHECK(duration_s >= 0),
    moving_time_s REAL CHECK(moving_time_s >= 0),
    avg_speed_mps REAL CHECK(avg_speed_mps >= 0),
    max_speed_mps REAL CHECK(max_speed_mps >= 0),
    avg_hr_bpm REAL CHECK(avg_hr_bpm >= 0),
    max_hr_bpm REAL CHECK(max_hr_bpm >= 0),
    avg_power_w REAL CHECK(avg_power_w >= 0),
    max_power_w REAL CHECK(max_power_w >= 0),
    elevation_gain_m REAL CHECK(elevation_gain_m >= 0),
    elevation_loss_m REAL CHECK(elevation_loss_m >= 0),
    avg_cadence_rpm REAL CHECK(avg_cadence_rpm >= 0),
    training_load REAL CHECK(training_load >= 0),
    synced_at TEXT NOT NULL,
    details_status TEXT NOT NULL CHECK(details_status IN ('complete', 'unavailable'))
  )`,
  'CREATE INDEX runs_start_time_id_idx ON runs(start_time, id)',
  `CREATE TABLE run_intervals (
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK(sequence >= 0),
    interval_type TEXT,
    duration_s REAL CHECK(duration_s >= 0),
    distance_m REAL CHECK(distance_m >= 0),
    avg_speed_mps REAL CHECK(avg_speed_mps >= 0),
    max_speed_mps REAL CHECK(max_speed_mps >= 0),
    avg_hr_bpm REAL CHECK(avg_hr_bpm >= 0),
    max_hr_bpm REAL CHECK(max_hr_bpm >= 0),
    avg_power_w REAL CHECK(avg_power_w >= 0),
    max_power_w REAL CHECK(max_power_w >= 0),
    elevation_gain_m REAL CHECK(elevation_gain_m >= 0),
    elevation_loss_m REAL CHECK(elevation_loss_m >= 0),
    avg_cadence_rpm REAL CHECK(avg_cadence_rpm >= 0),
    PRIMARY KEY(run_id, sequence)
  )`,
  `CREATE TABLE sync_runs (
    id TEXT PRIMARY KEY, mode TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL,
    ranges_json TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT,
    received INTEGER NOT NULL, upserted INTEGER NOT NULL, rejected INTEGER NOT NULL,
    requests INTEGER NOT NULL, completed_windows INTEGER NOT NULL, total_windows INTEGER NOT NULL,
    error_code TEXT
  )`,
  `CREATE TABLE coverage (
    resource TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, synced_at TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES sync_runs(id), PRIMARY KEY(resource, start, end)
  )`,
  `CREATE TABLE sync_issues (
    id TEXT PRIMARY KEY, sync_id TEXT NOT NULL REFERENCES sync_runs(id), resource TEXT NOT NULL,
    code TEXT NOT NULL, record_ref TEXT
  )`,
  'CREATE TABLE leases (name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL)',
];

export const initialMigration = {
  up: async (db: Kysely<unknown>) => {
    for (const statement of statements) await sql.raw(statement).execute(db);
  },
};
