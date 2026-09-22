import { createHash, randomUUID } from 'node:crypto';
import { dateSchema, type HealthMetric, type HealthValue, healthMetrics } from '@hub/contracts';
import type { IntervalRow, RunRow } from '@hub/db';
import { z } from 'zod';

const n = z.number().finite().nonnegative().nullish();
const text = z.string().nullish();
export const activitySchema = z
  .object({
    id: z.string().min(1).max(200),
    type: z.string(),
    start_date_local: z.string(),
    start_date: text,
    timezone: text,
    name: text,
    trainer: z.boolean().nullish(),
    distance: n,
    moving_time: n,
    elapsed_time: n,
    total_elevation_gain: n,
    average_heartrate: n,
    max_heartrate: n,
    average_cadence: n,
    icu_average_watts: n,
    icu_training_load: n,
  })
  .passthrough();
export const intervalSourceSchema = z
  .object({
    label: text,
    distance: n,
    moving_time: n,
    elapsed_time: n,
    average_heartrate: n,
    average_watts: n,
  })
  .passthrough();
export const wellnessSchema = z
  .object({
    id: dateSchema,
    ...Object.fromEntries(Object.values(healthMetrics).map((m) => [m.field, n])),
  })
  .passthrough();
export const runningTypes = new Set(['Run', 'TrailRun', 'VirtualRun']);
export function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function mapActivity(
  source: unknown,
  snapshotId: string,
  timezone: string,
  details: boolean,
) {
  const value = activitySchema.parse(source);
  if (!runningTypes.has(value.type)) throw new Error('NOT_RUNNING');
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value.start_date_local) ||
    !Number.isFinite(Date.parse(`${value.start_date_local}Z`))
  )
    throw new Error('INVALID_LOCAL_TIME');
  const localDate = dateSchema.parse(value.start_date_local.slice(0, 10));
  // Never infer UTC from an ambiguous local timestamp. An upstream offset/Z is required.
  const utc =
    value.start_date &&
    /(?:Z|[+-]\d{2}:?\d{2})$/.test(value.start_date) &&
    Number.isFinite(Date.parse(value.start_date))
      ? new Date(value.start_date).toISOString()
      : null;
  const id = randomUUID();
  const run: RunRow = {
    id,
    external_id: value.id,
    name: value.name ?? 'Untitled run',
    sport: value.type,
    start_utc: utc,
    start_local: value.start_date_local,
    local_date: localDate,
    timezone: value.timezone ?? timezone,
    indoor: value.trainer == null ? null : Number(value.trainer),
    distance_m: value.distance ?? null,
    moving_time_s: value.moving_time ?? null,
    elapsed_time_s: value.elapsed_time ?? null,
    elevation_m: value.total_elevation_gain ?? null,
    avg_hr_bpm: value.average_heartrate ?? null,
    max_hr_bpm: value.max_heartrate ?? null,
    avg_cadence: value.average_cadence ?? null,
    avg_power_w: value.icu_average_watts ?? null,
    training_load: value.icu_training_load ?? null,
    source_hash: hash(source),
    snapshot_id: snapshotId,
    synced_at: new Date().toISOString(),
    details_status: details ? 'complete' : 'unavailable',
    source_json: JSON.stringify(source),
  };
  let intervals: IntervalRow[] | null = null;
  if (details) {
    const raw = z
      .array(intervalSourceSchema)
      .max(10000)
      .parse(value.icu_intervals ?? []);
    intervals = raw.map((interval, index) => ({
      run_id: id,
      interval_index: index,
      label: interval.label ?? null,
      distance_m: interval.distance ?? null,
      moving_time_s: interval.moving_time ?? null,
      elapsed_time_s: interval.elapsed_time ?? null,
      avg_hr_bpm: interval.average_heartrate ?? null,
      avg_power_w: interval.average_watts ?? null,
      source_json: JSON.stringify(interval),
    }));
  }
  return { run, intervals };
}
export function mapWellness(source: unknown, snapshotId: string) {
  const value = wellnessSchema.parse(source);
  const syncedAt = new Date().toISOString();
  const day = {
    local_date: value.id,
    source_json: JSON.stringify(source),
    source_hash: hash(source),
    synced_at: syncedAt,
    snapshot_id: snapshotId,
  };
  const values: HealthValue[] = Object.entries(healthMetrics).map(([metric, meta]) => ({
    local_date: value.id,
    metric: metric as HealthMetric,
    value: (value[meta.field] as number | null | undefined) ?? null,
    unit: meta.unit,
    definition: meta.definition,
    synced_at: syncedAt,
    snapshot_id: snapshotId,
  }));
  return { day, values };
}
