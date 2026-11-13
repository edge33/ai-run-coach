import { dateSchema, localTimestampSchema } from '@hub/contracts';
import { z } from 'zod';
import { GarminContractError } from './errors.ts';

// Validate the fields we consume. Additional upstream fields are stripped, never persisted.
// Device-dependent readings may be absent; stable envelope/core fields must be present.
const measurement = z
  .number()
  .finite()
  .nonnegative()
  .nullish()
  .transform((value) => value ?? null);
const identifier = z.union([
  z.string().regex(/^\d+$/),
  z.number().int().nonnegative().safe().transform(String),
]);
const activityType = z.object({ typeKey: z.string(), parentTypeId: z.number().int().nullish() });
const timestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/)
  .refine((value) => localTimestampSchema.safeParse(value.replace(' ', 'T').split('.')[0]).success);
const activityListSchema = z
  .array(
    z.object({
      activityId: identifier,
      activityType,
      startTimeLocal: timestamp,
    }),
  )
  .max(50);
export const summarySchema = z.object({
  startTimeLocal: timestamp.optional(),
  startTimeGMT: timestamp.optional(),
  distance: measurement,
  elapsedDuration: measurement,
  duration: measurement,
  movingDuration: measurement,
  averageSpeed: measurement,
  maxSpeed: measurement,
  averageHR: measurement,
  maxHR: measurement,
  averagePower: measurement,
  elevationGain: measurement,
  elevationLoss: measurement,
  averageRunCadence: measurement,
});
const steps = z
  .array(
    z.object({
      stepIndex: z.number().int().nonnegative(),
      intensity: z.string().nullish(),
      durationType: z.string().nullish(),
      durationValue: measurement,
      targetType: z.string().nullish(),
      targetValue: measurement,
      targetValueLow: measurement,
      targetValueHigh: measurement,
    }),
  )
  .max(10000);
const workouts = z.array(z.object({ steps: steps.optional() })).max(100);

export const activityDetailSchema = z.object({
  activityId: identifier,
  activityTypeDTO: activityType,
  summaryDTO: summarySchema.extend({
    startTimeLocal: timestamp,
    distance: z.number().finite().nonnegative().nullable(),
    elapsedDuration: z.number().finite().nonnegative().nullable(),
    duration: z.number().finite().nonnegative().nullable(),
  }),
  splitSummaries: z
    .array(
      summarySchema.extend({
        splitType: z.string().max(100).nullish(),
        noOfSplits: z.number().int().nonnegative().nullish(),
      }),
    )
    .max(10000)
    .optional(),
});

const nullableMeasurement = z.number().finite().nonnegative().nullable();
const dailySchema = z
  .object({ calendarDate: dateSchema, restingHeartRate: nullableMeasurement })
  .nullable();
const sleepSchema = z
  // Garmin's DailySleepDTO does not require calendarDate. The request identifies the day;
  // validate a source date when supplied, while preserving absent/null source dates.
  .object({ calendarDate: dateSchema.nullish(), sleepTimeSeconds: nullableMeasurement })
  .nullable();
const hrvSchema = z
  .object({
    hrvSummary: z
      .object({ calendarDate: dateSchema, lastNightAvg: nullableMeasurement })
      .nullable(),
  })
  .nullable();
const weightSchema = z.object({
  dailyWeightSummaries: z
    .array(
      z.object({
        summaryDate: dateSchema,
        latestWeight: z
          .object({ calendarDate: dateSchema, weight: nullableMeasurement })
          .nullable(),
      }),
    )
    .max(31),
});

// Range endpoints can include undated no-sleep placeholders. Never assign those by array
// position; retain dated zero readings and reject undated rows carrying positive sleep time.
const sleepRangeSchema = z
  .array(sleepSchema.unwrap())
  .max(31)
  .superRefine((rows, context) => {
    for (const [index, row] of rows.entries()) {
      if (row.calendarDate == null && row.sleepTimeSeconds !== null && row.sleepTimeSeconds > 0) {
        context.addIssue({
          code: 'invalid_type',
          expected: 'string',
          path: [index, 'calendarDate'],
        });
      }
    }
  })
  .transform((rows) =>
    rows.filter((row): row is typeof row & { calendarDate: string } => row.calendarDate != null),
  );
const hrvRangeSchema = z
  .object({
    hrvSummaries: z
      .array(z.object({ calendarDate: dateSchema, lastNightAvg: nullableMeasurement }))
      .max(31),
  })
  .nullable();

const dailyRangeSchema = z.object({
  data: z
    .array(
      z.object({
        calendarDate: dateSchema,
        heartRate: z.object({ restingValue: measurement }).nullish(),
      }),
    )
    .max(31),
});

export const garminResponses = {
  token: {
    name: 'token',
    schema: z.string().regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
  },
  activities: { name: 'activities', schema: activityListSchema },
  activity: { name: 'activity', schema: activityDetailSchema },
  daily: { name: 'daily', schema: dailySchema },
  dailyRange: { name: 'daily_range', schema: dailyRangeSchema },
  sleep: { name: 'sleep', schema: sleepSchema },
  sleepRange: { name: 'sleep_range', schema: sleepRangeSchema },
  hrvRange: { name: 'hrv_range', schema: hrvRangeSchema },
  hrv: { name: 'hrv', schema: hrvSchema },
  weight: { name: 'weight', schema: weightSchema },
  workouts: { name: 'workouts', schema: workouts },
};

function receivedType(input: unknown, path: PropertyKey[]): string {
  let value = input;
  for (const key of path) {
    if (value === null || typeof value !== 'object') return 'undefined';
    value = (value as Record<PropertyKey, unknown>)[key];
  }
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}

export function validateGarminResponse<T>(
  contract: { name: string; schema: z.ZodType<T> },
  input: unknown,
): T {
  const result = contract.schema.safeParse(input);
  if (!result.success) {
    // Keep only field paths and issue codes. Never attach response bodies or source values.
    throw new GarminContractError(
      contract.name,
      result.error.issues.slice(0, 10).map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        ...(issue.code === 'invalid_type'
          ? {
              expected: issue.expected,
              received: receivedType(input, issue.path),
            }
          : {}),
      })),
    );
  }
  return result.data;
}
