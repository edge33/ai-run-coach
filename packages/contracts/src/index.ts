import { z } from 'zod';

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Use a valid YYYY-MM-DD date');
export const rangeSchema = z.object({ start: dateSchema, end: dateSchema }).strict();
export type DateRange = z.infer<typeof rangeSchema>;
export const pageSchema = rangeSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export const syncRequestSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('recent') }).strict(),
  z.object({ mode: z.literal('all') }).strict(),
  z.object({ mode: z.literal('range'), start: dateSchema, end: dateSchema }).strict(),
]);
export type SyncRequest = z.infer<typeof syncRequestSchema>;
export const healthMetrics = {
  resting_hr_bpm: { field: 'restingHR', unit: 'bpm', definition: 'Resting heart rate' },
  hrv_ms: { field: 'hrv', unit: 'ms', definition: 'Heart rate variability' },
  sleep_duration_s: { field: 'sleepSecs', unit: 's', definition: 'Sleep duration' },
  weight_kg: { field: 'weight', unit: 'kg', definition: 'Body weight' },
  fitness_ctl: { field: 'ctl', unit: 'load', definition: 'Chronic training load' },
  fatigue_atl: { field: 'atl', unit: 'load', definition: 'Acute training load' },
  form_tsb: { field: 'ctl - atl', unit: 'load', definition: 'Same-day fitness minus fatigue' },
  training_load: { field: 'ctlLoad', unit: 'load', definition: 'Daily training load' },
} as const;
export type HealthMetric = keyof typeof healthMetrics;
export const metricSchema = z.enum(Object.keys(healthMetrics) as [HealthMetric, ...HealthMetric[]]);
export const healthQuerySchema = pageSchema.extend({
  metric: metricSchema.default('resting_hr_bpm'),
});
const measurement = z.number().finite().nonnegative().nullable();
export const runSchema = z.object({
  id: z.string(),
  start_time: z.string(),
  indoor: z.number().int().min(0).max(1).nullable(),
  distance_m: measurement,
  duration_s: measurement,
  moving_time_s: measurement,
  avg_speed_mps: measurement,
  max_speed_mps: measurement,
  avg_hr_bpm: measurement,
  max_hr_bpm: measurement,
  avg_power_w: measurement,
  max_power_w: measurement,
  elevation_gain_m: measurement,
  elevation_loss_m: measurement,
  avg_cadence_rpm: measurement,
  training_load: measurement,
  synced_at: z.string(),
  details_status: z.enum(['complete', 'unavailable']),
});
export type Run = z.infer<typeof runSchema>;
export const intervalSchema = z.object({
  run_id: z.string(),
  sequence: z.number().int().nonnegative(),
  interval_type: z.string().nullable(),
  duration_s: measurement,
  distance_m: measurement,
  avg_speed_mps: measurement,
  max_speed_mps: measurement,
  avg_hr_bpm: measurement,
  max_hr_bpm: measurement,
  avg_power_w: measurement,
  max_power_w: measurement,
  elevation_gain_m: measurement,
  elevation_loss_m: measurement,
  avg_cadence_rpm: measurement,
});
export type RunInterval = z.infer<typeof intervalSchema>;
export const wellnessSchema = z.object({
  date: dateSchema,
  resting_hr_bpm: measurement,
  hrv_ms: measurement,
  sleep_duration_s: measurement,
  weight_kg: measurement,
  fitness_ctl: measurement,
  fatigue_atl: measurement,
  form_tsb: z.number().finite().nullable(),
  training_load: measurement,
  synced_at: z.string(),
});
export type Wellness = z.infer<typeof wellnessSchema>;
export const syncRunSchema = z.object({
  id: z.string(),
  mode: z.enum(['recent', 'range', 'all']),
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
