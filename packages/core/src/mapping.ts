import { createHash } from 'node:crypto';
import {
  dateSchema,
  intervalSchema,
  localTimestampSchema,
  runSchema,
  wellnessSchema,
} from '@hub/contracts';
import { z } from 'zod';

const measurement = z.number().finite().nonnegative().nullish();
export const intervalSourceSchema = z.object({
  type: z.string().nullish(),
  label: z.string().max(2000).nullish(),
  start_index: z.number().int().nonnegative().nullish(),
  end_index: z.number().int().nonnegative().nullish(),
  start_time: measurement,
  end_time: measurement,
  moving_time: measurement,
  elapsed_time: measurement,
  distance: measurement,
  average_speed: measurement,
  max_speed: measurement,
  average_heartrate: measurement,
  max_heartrate: measurement,
  average_watts: measurement,
  max_watts: measurement,
  total_elevation_gain: measurement,
  average_cadence: measurement,
});
export const activitySchema = z.object({
  id: z.string().min(1).max(200),
  type: z.string(),
  start_date_local: localTimestampSchema,
  trainer: z.boolean().nullish(),
  power_field: z.string().max(200).nullish(),
  distance: measurement,
  elapsed_time: measurement,
  moving_time: measurement,
  average_speed: measurement,
  max_speed: measurement,
  average_heartrate: measurement,
  max_heartrate: measurement,
  icu_average_watts: measurement,
  total_elevation_gain: measurement,
  total_elevation_loss: measurement,
  average_cadence: measurement,
  icu_training_load: measurement,
  icu_intervals: z.array(intervalSourceSchema).max(10000).optional(),
});
export const wellnessSourceSchema = z.object({
  id: dateSchema,
  restingHR: measurement,
  hrv: measurement,
  sleepSecs: measurement,
  weight: measurement,
  ctl: measurement,
  atl: measurement,
  ctlLoad: measurement,
});
export const runningTypes = new Set(['Run', 'TrailRun', 'VirtualRun']);
export function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function mapActivity(source: unknown, details: boolean) {
  const value = activitySchema.parse(source);
  if (!runningTypes.has(value.type)) throw new Error('NOT_RUNNING');
  dateSchema.parse(value.start_date_local.slice(0, 10));
  const run = runSchema.parse({
    id: value.id,
    start_time: value.start_date_local,
    indoor: value.trainer == null ? null : Number(value.trainer),
    power_source: value.power_field ?? null,
    distance_m: value.distance ?? null,
    duration_s: value.elapsed_time ?? null,
    moving_time_s: value.moving_time ?? null,
    avg_speed_mps: value.average_speed ?? null,
    max_speed_mps: value.max_speed ?? null,
    avg_hr_bpm: value.average_heartrate ?? null,
    max_hr_bpm: value.max_heartrate ?? null,
    avg_power_w: value.icu_average_watts ?? null,
    elevation_gain_m: value.total_elevation_gain ?? null,
    elevation_loss_m: value.total_elevation_loss ?? null,
    avg_cadence_rpm: value.average_cadence ?? null,
    training_load: value.icu_training_load ?? null,
    synced_at: new Date().toISOString(),
    details_status: details ? 'complete' : 'unavailable',
  });
  const intervals = details
    ? z
        .array(intervalSourceSchema)
        .max(10000)
        .parse(value.icu_intervals)
        .map((interval, sequence) =>
          intervalSchema.parse({
            run_id: run.id,
            sequence,
            interval_type: interval.type ?? null,
            label: interval.label ?? null,
            start_index: interval.start_index ?? null,
            end_index: interval.end_index ?? null,
            start_time_s: interval.start_time ?? null,
            end_time_s: interval.end_time ?? null,
            moving_time_s: interval.moving_time ?? null,
            duration_s: interval.elapsed_time ?? null,
            distance_m: interval.distance ?? null,
            avg_speed_mps: interval.average_speed ?? null,
            max_speed_mps: interval.max_speed ?? null,
            avg_hr_bpm: interval.average_heartrate ?? null,
            max_hr_bpm: interval.max_heartrate ?? null,
            avg_power_w: interval.average_watts ?? null,
            max_power_w: interval.max_watts ?? null,
            elevation_gain_m: interval.total_elevation_gain ?? null,
            avg_cadence_rpm: interval.average_cadence ?? null,
          }),
        )
    : null;
  return { run, intervals };
}

export function mapWellness(source: unknown) {
  const value = wellnessSourceSchema.parse(source);
  return wellnessSchema.parse({
    date: value.id,
    resting_hr_bpm: value.restingHR ?? null,
    hrv_ms: value.hrv ?? null,
    sleep_duration_s: value.sleepSecs ?? null,
    weight_kg: value.weight ?? null,
    fitness_ctl: value.ctl ?? null,
    fatigue_atl: value.atl ?? null,
    form_tsb: value.ctl == null || value.atl == null ? null : value.ctl - value.atl,
    training_load: value.ctlLoad ?? null,
    synced_at: new Date().toISOString(),
  });
}
