import { z } from 'zod';

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Use a valid YYYY-MM-DD date');
export const localTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 19) === value;
  }, 'Use a valid local timestamp');
export const rangeSchema = z.object({ start: dateSchema, end: dateSchema }).strict();
export type DateRange = z.infer<typeof rangeSchema>;
export const pageSchema = rangeSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export const recordListQuerySchema = pageSchema
  .partial({ start: true, end: true })
  .extend({ limit: z.coerce.number().int().min(1).max(50).default(50) })
  .refine((query) => (query.start === undefined) === (query.end === undefined), {
    message: 'Provide both start and end, or neither.',
  });

export const DEFAULT_SYNC_DAYS = 15;
export const MAX_SYNC_DAYS = 90;
export const MAX_RUN_SAMPLES = 200000;
export const sampleQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(100),
    offset: z.coerce.number().int().min(0).max(MAX_RUN_SAMPLES).default(0),
  })
  .strict();

export const syncRequestSchema = z
  .object({ mode: z.literal('range'), start: dateSchema, end: dateSchema })
  .strict();
export type SyncRequest = z.infer<typeof syncRequestSchema>;
export const DATA_SOURCE = 'garmin_connect' as const;
export const MAPPING_VERSION = '1.0.0' as const;
export const healthMetrics = {
  resting_hr_bpm: {
    unit: 'bpm',
    definition: 'Garmin resting heart rate, or minimum heart rate when resting is unavailable',
  },
  hrv_ms: { unit: 'ms', definition: 'Average overnight HRV' },
  sleep_duration_s: { unit: 's', definition: 'Nightly sleep duration excluding naps' },
  weight_kg: { unit: 'kg', definition: 'Latest same-day body weight' },
} as const;
export type HealthMetric = keyof typeof healthMetrics;
export const metricSchema = z.enum(Object.keys(healthMetrics) as [HealthMetric, ...HealthMetric[]]);
export const healthQuerySchema = pageSchema;
const measurement = z.number().finite().nonnegative().nullable().default(null);
const idSchema = z.string().min(1).max(200);
const metrics = {
  distance_m: measurement,
  duration_s: measurement,
  timer_time_s: measurement,
  moving_time_s: measurement,
  avg_speed_mps: measurement,
  max_speed_mps: measurement,
  avg_hr_bpm: measurement,
  max_hr_bpm: measurement,
  avg_power_w: measurement,
  elevation_gain_m: measurement,
  elevation_loss_m: measurement,
  avg_cadence_spm: measurement,
};
export const runSchema = z.object({
  id: idSchema,
  start_time: localTimestampSchema,
  indoor: z.number().int().min(0).max(1).nullable().default(null),
  ...metrics,
  synced_at: z.string(),
  details_status: z.enum(['complete', 'unavailable']).default('complete'),
  samples_synced_at: z.string().nullable().default(null),
});
export type Run = z.infer<typeof runSchema>;
export const timingWarningSchema = z
  .enum(['INVALID_SOURCE_BOUNDARY', 'LAP_TIMESTAMP_NOT_END', 'DURATION_TIMESTAMP_MISMATCH'])
  .nullable()
  .default(null);
const segment = {
  run_id: idSchema,
  sequence: z.number().int().min(0).max(9999),
  start_time_s: measurement,
  end_time_s: measurement,
  timing_warning: timingWarningSchema,
  ...metrics,
  max_power_w: measurement,
};
export const lapSchema = z.object({
  ...segment,
  message_time_s: measurement,
  intensity: z.string().max(100).nullable().default(null),
  trigger: z.string().max(100).nullable().default(null),
  workout_step_index: z.number().int().nonnegative().nullable().default(null),
});
export type RunLap = z.infer<typeof lapSchema>;
export const splitSchema = z.object({
  ...segment,
  split_type: z.string().min(1).max(100),
  first_lap_index: z.number().int().nonnegative().nullable().default(null),
  number_of_laps: z.number().int().nonnegative().nullable().default(null),
});
export type RunSplit = z.infer<typeof splitSchema>;
export const runSampleSchema = z.object({
  run_id: idSchema,
  sample_index: z
    .number()
    .int()
    .min(0)
    .max(MAX_RUN_SAMPLES - 1),
  elapsed_s: z.number().finite().nonnegative(),
  distance_m: measurement,
  speed_mps: measurement,
  hr_bpm: measurement,
  power_w: measurement,
  altitude_m: z.number().finite().nullable().default(null),
  cadence_spm: measurement,
});
export type RunSample = z.infer<typeof runSampleSchema>;
export const runSamplePageSchema = z.object({
  source: z.literal(DATA_SOURCE),
  run_id: z.string(),
  synced_at: z.string().nullable(),
  items: z.array(runSampleSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export const runDetailQuerySchema = z
  .object({
    lap_offset: z.coerce.number().int().min(0).max(10000).default(0),
    split_offset: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();
export const runDetailSchema = z.object({
  source: z.literal(DATA_SOURCE),
  run: runSchema,
  laps: z.array(lapSchema),
  lap_total: z.number(),
  lap_offset: z.number(),
  splits: z.array(splitSchema),
  split_total: z.number(),
  split_offset: z.number(),
});
export const wellnessSchema = z.object({
  date: dateSchema,
  resting_hr_bpm: measurement,
  hrv_ms: measurement,
  sleep_duration_s: measurement,
  weight_kg: measurement,
  synced_at: z.string(),
});
export type Wellness = z.infer<typeof wellnessSchema>;
export const syncRunSchema = z.object({
  id: z.string(),
  // Historical mode names remain readable; new imports accept explicit ranges only.
  mode: z.string(),
  start: z.string(),
  end: z.string(),
  ranges_json: z.string(),
  status: z.enum(['running', 'completed', 'partial', 'failed', 'interrupted']),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  received: z.number(),
  upserted: z.number(),
  rejected: z.number(),
  requests: z.number(),
  completed_windows: z.number(),
  total_windows: z.number(),
  error_code: z.string().nullable(),
});
export type SyncRun = z.infer<typeof syncRunSchema>;
export const coverageSchema = z.object({
  resource: z.enum(['runs', 'health']),
  start: z.string(),
  end: z.string(),
  synced_at: z.string(),
  run_id: z.string(),
});
export type Coverage = z.infer<typeof coverageSchema>;
export const statusSchema = z.object({
  cooldown_until: z.iso.datetime().nullable().optional(),
  timezone: z.string(),
  today: z.string(),
  coverage: z.array(coverageSchema),
  latest: syncRunSchema.nullable(),
  active: syncRunSchema.nullable(),
  run_count: z.number(),
  health_days: z.number(),
});
export type DataStatus = z.infer<typeof statusSchema>;
export const runSummarySchema = z.object({
  period: rangeSchema,
  sample_size: z.number(),
  source: z.literal('local_database'),
  calculation_version: z.literal('1.0.0'),
  coverage: z.array(coverageSchema),
  warnings: z.array(z.string()),
  values: z.record(
    z.string(),
    z.object({
      value: z.number().nullable(),
      unit: z.string(),
      measured: z.number(),
      missing: z.number(),
    }),
  ),
});
export type RunSummary = z.infer<typeof runSummarySchema>;
export const healthSummarySchema = z.object({
  period: rangeSchema,
  metric: metricSchema,
  unit: z.string(),
  definition: z.string(),
  sample_size: z.number(),
  observed_days: z.number(),
  missing: z.number(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  mean: z.number().nullable(),
  coverage: z.array(coverageSchema),
  warnings: z.array(z.string()),
});
export type HealthSummary = z.infer<typeof healthSummarySchema>;
export const pages = [
  'background',
  'goals',
  'availability',
  'zones',
  'preferences',
  'limitations',
] as const;
export const wikiPageSchema = z.enum(pages);
export const factInputSchema = z
  .object({
    page: wikiPageSchema,
    key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    value: z.string().trim().min(1).max(2000),
    source: z.string().trim().min(1).max(2000),
    expected_revision: z.string().nullable(),
  })
  .strict();
export type FactInput = z.infer<typeof factInputSchema>;

export function addDays(date: string, days: number): string {
  const value = new Date(`${dateSchema.parse(date)}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function localToday(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function validateRange(input: DateRange, maxDays = 3660): DateRange {
  const range = rangeSchema.parse({ start: input.start, end: input.end });
  const days = (Date.parse(range.end) - Date.parse(range.start)) / 86400000 + 1;
  if (days < 1 || days > maxDays) throw new Error(`Date range must contain 1–${maxDays} days`);
  return range;
}
