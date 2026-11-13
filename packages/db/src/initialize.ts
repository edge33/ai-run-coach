const metrics = `
  distance_m REAL CHECK(distance_m >= 0),
  duration_s REAL CHECK(duration_s >= 0),
  timer_time_s REAL CHECK(timer_time_s >= 0),
  moving_time_s REAL CHECK(moving_time_s >= 0),
  avg_speed_mps REAL CHECK(avg_speed_mps >= 0),
  max_speed_mps REAL CHECK(max_speed_mps >= 0),
  avg_hr_bpm REAL CHECK(avg_hr_bpm >= 0),
  max_hr_bpm REAL CHECK(max_hr_bpm >= 0),
  avg_power_w REAL CHECK(avg_power_w >= 0),
  elevation_gain_m REAL CHECK(elevation_gain_m >= 0),
  elevation_loss_m REAL CHECK(elevation_loss_m >= 0),
  avg_cadence_spm REAL CHECK(avg_cadence_spm >= 0)`;
const segment = `
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK(sequence >= 0 AND sequence < 10000),
  start_time_s REAL CHECK(start_time_s >= 0),
  end_time_s REAL CHECK(end_time_s >= 0 AND (start_time_s IS NULL OR end_time_s >= start_time_s)),
  timing_warning TEXT CHECK(timing_warning IN ('INVALID_SOURCE_BOUNDARY', 'LAP_TIMESTAMP_NOT_END', 'DURATION_TIMESTAMP_MISMATCH')),
  max_power_w REAL CHECK(max_power_w >= 0),
  ${metrics}`;

export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, start_time TEXT NOT NULL,
        indoor INTEGER CHECK(indoor IN (0, 1)), ${metrics},
        synced_at TEXT NOT NULL, samples_synced_at TEXT,
        details_status TEXT NOT NULL CHECK(details_status IN ('complete', 'unavailable'))
      ) STRICT`,
  'CREATE INDEX IF NOT EXISTS runs_start_time_id_idx ON runs(start_time, id)',
  `CREATE TABLE IF NOT EXISTS run_laps (
        ${segment}, message_time_s REAL CHECK(message_time_s >= 0),
        intensity TEXT, trigger TEXT, workout_step_index INTEGER CHECK(workout_step_index >= 0),
        PRIMARY KEY(run_id, sequence)
      ) STRICT`,
  `CREATE TABLE IF NOT EXISTS run_splits (
        ${segment}, split_type TEXT NOT NULL,
        first_lap_index INTEGER CHECK(first_lap_index >= 0),
        number_of_laps INTEGER CHECK(number_of_laps >= 0),
        PRIMARY KEY(run_id, sequence)
      ) STRICT`,
  `CREATE TABLE IF NOT EXISTS run_samples (
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        sample_index INTEGER NOT NULL CHECK(sample_index >= 0 AND sample_index < 200000),
        elapsed_s REAL NOT NULL CHECK(elapsed_s >= 0),
        distance_m REAL CHECK(distance_m >= 0), speed_mps REAL CHECK(speed_mps >= 0),
        hr_bpm REAL CHECK(hr_bpm >= 0), power_w REAL CHECK(power_w >= 0),
        altitude_m REAL, cadence_spm REAL CHECK(cadence_spm >= 0),
        PRIMARY KEY(run_id, sample_index)
      ) STRICT`,
  `CREATE TABLE IF NOT EXISTS wellness (
        date TEXT PRIMARY KEY, resting_hr_bpm REAL CHECK(resting_hr_bpm >= 0),
        hrv_ms REAL CHECK(hrv_ms >= 0), sleep_duration_s REAL CHECK(sleep_duration_s >= 0),
        weight_kg REAL CHECK(weight_kg >= 0), synced_at TEXT NOT NULL
      ) STRICT`,

  `CREATE TABLE IF NOT EXISTS sync_runs (
    id TEXT PRIMARY KEY, mode TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL,
    ranges_json TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT,
    received INTEGER NOT NULL, upserted INTEGER NOT NULL, rejected INTEGER NOT NULL,
    requests INTEGER NOT NULL, completed_windows INTEGER NOT NULL, total_windows INTEGER NOT NULL,
    error_code TEXT
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS coverage (
    resource TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, synced_at TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES sync_runs(id), PRIMARY KEY(resource, start, end)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS sync_issues (
    id TEXT PRIMARY KEY, sync_id TEXT NOT NULL REFERENCES sync_runs(id), resource TEXT NOT NULL,
    code TEXT NOT NULL, record_ref TEXT
  ) STRICT`,
  'CREATE TABLE IF NOT EXISTS leases (name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL) STRICT',
];
