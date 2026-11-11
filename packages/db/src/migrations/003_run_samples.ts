import { type Kysely, sql } from 'kysely';

export const runSamples = {
  up: async (db: Kysely<unknown>) => {
    const statements = [
      'ALTER TABLE runs ADD COLUMN power_source TEXT',
      'ALTER TABLE runs ADD COLUMN samples_synced_at TEXT',
      'ALTER TABLE run_intervals ADD COLUMN label TEXT',
      'ALTER TABLE run_intervals ADD COLUMN start_index INTEGER CHECK(start_index >= 0)',
      'ALTER TABLE run_intervals ADD COLUMN end_index INTEGER CHECK(end_index >= 0 AND (start_index IS NULL OR end_index >= start_index))',
      'ALTER TABLE run_intervals ADD COLUMN start_time_s REAL CHECK(start_time_s >= 0)',
      'ALTER TABLE run_intervals ADD COLUMN end_time_s REAL CHECK(end_time_s >= 0 AND (start_time_s IS NULL OR end_time_s >= start_time_s))',
      'ALTER TABLE run_intervals ADD COLUMN moving_time_s REAL CHECK(moving_time_s >= 0)',
      `CREATE TABLE run_samples (
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        sample_index INTEGER NOT NULL CHECK(sample_index >= 0 AND sample_index < 200000),
        elapsed_s REAL NOT NULL CHECK(elapsed_s >= 0),
        distance_m REAL CHECK(distance_m >= 0),
        speed_mps REAL CHECK(speed_mps >= 0),
        hr_bpm REAL CHECK(hr_bpm >= 0),
        power_w REAL CHECK(power_w >= 0),
        raw_power_w REAL CHECK(raw_power_w >= 0),
        altitude_m REAL,
        corrected_altitude_m REAL,
        cadence_rpm REAL CHECK(cadence_rpm >= 0),
        PRIMARY KEY(run_id, sample_index)
      ) STRICT`,
    ];
    for (const statement of statements) await sql.raw(statement).execute(db);
  },
};
