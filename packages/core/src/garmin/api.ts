import { type DateRange, dateSchema } from '@hub/contracts';
import type { z } from 'zod';
import { type GarminClient, GarminError } from './client.ts';
import { garminResponses, summarySchema, validateGarminResponse } from './schemas.ts';

export const runningTypes = new Set([
  'running',
  'street_running',
  'trail_running',
  'treadmill_running',
  'indoor_running',
  'track_running',
  'virtual_run',
  'virtual_running',
]);
export function normalizeSummary(input: unknown) {
  const value = summarySchema.parse(input);
  return {
    distance_m: value.distance,
    duration_s: value.elapsedDuration,
    timer_time_s: value.duration,
    moving_time_s: value.movingDuration,
    avg_speed_mps: value.averageSpeed,
    max_speed_mps: value.maxSpeed,
    avg_hr_bpm: value.averageHR,
    max_hr_bpm: value.maxHR,
    avg_power_w: value.averagePower,
    elevation_gain_m: value.elevationGain,
    elevation_loss_m: value.elevationLoss,
    avg_cadence_spm: value.averageRunCadence,
  };
}

export async function listActivities(client: GarminClient, range: DateRange, maxActivities = 50) {
  const activities: z.output<typeof garminResponses.activities.schema> = [];
  const seen = new Set<string>();
  let offset = 0;
  for (let pageNumber = 0; pageNumber <= maxActivities; pageNumber++) {
    const query = new URLSearchParams({
      startDate: range.start,
      endDate: range.end,
      start: String(offset),
      limit: '50',
      sortOrder: 'asc',
      sortBy: 'startLocal',
      excludeChildren: 'false',
    });
    const page = await client.json(
      `/activitylist-service/activities/search/activities?${query}`,
      garminResponses.activities,
    );
    let added = 0;
    for (const activity of page) {
      const date = dateSchema.parse(activity.startTimeLocal.slice(0, 10));
      if (date < range.start || date > range.end) throw new GarminError('ACTIVITY_OUTSIDE_RANGE');
      if (!seen.has(activity.activityId)) {
        seen.add(activity.activityId);
        activities.push(activity);
        added++;
      }
    }
    if (activities.length > maxActivities) throw new GarminError('ACTIVITY_LIMIT');
    // Only an empty page proves traversal finished, even if the server caps page size.
    if (!page.length) return activities;
    if (!added) throw new GarminError('NON_ADVANCING_PAGINATION');
    offset += page.length;
  }
  throw new GarminError('PAGINATION_LIMIT');
}

export function normalizeWellness(
  date: string,
  daily: unknown,
  sleep: unknown,
  hrv: unknown,
  weight: unknown,
) {
  const dailyValue = validateGarminResponse(garminResponses.daily, daily);
  const sleepValue = validateGarminResponse(garminResponses.sleep, sleep);
  const hrvValue = validateGarminResponse(garminResponses.hrv, hrv)?.hrvSummary;
  for (const value of [dailyValue, sleepValue, hrvValue]) {
    if (value?.calendarDate != null && value.calendarDate !== date)
      throw new GarminError('WELLNESS_DATE_MISMATCH');
  }
  const weights = validateGarminResponse(garminResponses.weight, weight);
  const matches = weights.dailyWeightSummaries.filter((entry) => entry.summaryDate === date);
  if (matches.length > 1) throw new GarminError('DUPLICATE_WEIGHT_DATE');
  const latest = matches[0]?.latestWeight;
  if (latest && latest.calendarDate !== date) throw new GarminError('WEIGHT_DATE_MISMATCH');
  return {
    date,
    resting_hr_bpm: dailyValue?.restingHeartRate ?? null,
    hrv_ms: hrvValue?.lastNightAvg ?? null,
    sleep_duration_s: sleepValue?.sleepTimeSeconds ?? null,
    weight_kg: latest?.weight ?? null,
  };
}
