import {
  addDays,
  type DateRange,
  lapSchema,
  runSampleSchema,
  runSchema,
  splitSchema,
  validateRange,
  wellnessSchema,
} from '@hub/contracts';
import { normalizeSummary, normalizeWellness, runningTypes } from './api.ts';
import { type GarminClient, GarminError } from './client.ts';
import { decodeActivityFile } from './fit.ts';
import { garminResponses, validateGarminResponse } from './schemas.ts';

export function mapGarminRun(
  input: unknown,
  file: Uint8Array,
  range: DateRange,
  syncedAt = new Date().toISOString(),
) {
  const detail = validateGarminResponse(garminResponses.activity, input);
  const type = detail.activityTypeDTO.typeKey;
  if (!runningTypes.has(type)) throw new GarminError('NOT_RUNNING');
  const localStart = detail.summaryDTO.startTimeLocal.replace(' ', 'T').split('.')[0];
  if (localStart.slice(0, 10) < range.start || localStart.slice(0, 10) > range.end)
    throw new GarminError('ACTIVITY_OUTSIDE_RANGE');
  const fit = decodeActivityFile(file);
  if (fit.sport !== 'running') throw new GarminError('FIT_SPORT_MISMATCH');
  const startGMT = detail.summaryDTO.startTimeGMT;
  if (
    startGMT &&
    Math.abs(Date.parse(`${startGMT.replace(' ', 'T')}Z`) - Date.parse(fit.start_time_utc)) > 1000
  ) {
    throw new GarminError('FIT_START_TIME_MISMATCH');
  }
  const run = runSchema.parse({
    id: detail.activityId,
    start_time: localStart,
    indoor:
      type === 'treadmill_running' || type === 'indoor_running'
        ? 1
        : type.startsWith('virtual')
          ? null
          : 0,
    ...normalizeSummary(detail.summaryDTO),
    synced_at: syncedAt,
    samples_synced_at: syncedAt,
  });
  const laps = fit.laps.map((lap) => lapSchema.parse({ ...lap, run_id: run.id }));
  // Garmin's overlapping run/walk/stand classifications are not workout splits.
  // Preserve original sequence numbers so filtering never rewrites source identity.
  const splits = fit.splits
    .filter((split) => split.split_type?.startsWith('interval'))
    .map((split) => splitSchema.parse({ ...split, run_id: run.id }));
  const samples = fit.samples.map((sample) => runSampleSchema.parse({ ...sample, run_id: run.id }));
  return { run, laps, splits, samples };
}

function indexByDate<T extends { calendarDate: string }>(rows: T[], range: DateRange) {
  const indexed = new Map<string, T>();
  for (const row of rows) {
    if (row.calendarDate < range.start || row.calendarDate > range.end)
      throw new GarminError('WELLNESS_DATE_MISMATCH');
    if (indexed.has(row.calendarDate)) throw new GarminError('DUPLICATE_WELLNESS_DATE');
    indexed.set(row.calendarDate, row);
  }
  return indexed;
}

export async function fetchGarminWellnessRange(
  client: GarminClient,
  input: DateRange,
  weight: unknown,
) {
  const range = validateRange(input, 31);
  const sleepRows = await client.json(
    `/sleep-service/sleep/dailySleepSummariesByDate?${new URLSearchParams({ startDate: range.start, endDate: range.end })}`,
    garminResponses.sleepRange,
  );
  const hrvRows = await client.json(
    `/hrv-service/hrv/daily/${range.start}/${range.end}`,
    garminResponses.hrvRange,
  );
  const sleep = indexByDate(sleepRows, range);
  const hrv = indexByDate(hrvRows?.hrvSummaries ?? [], range);
  const dailyRows = await client.json(
    `/usersummary-service/v2/dailysummaries?${new URLSearchParams({ startDate: range.start, endDate: range.end })}`,
    garminResponses.dailyRange,
  );
  const daily = indexByDate(dailyRows.data, range);
  const rows = [];
  for (let date = range.start; date <= range.end; date = addDays(date, 1)) {
    const summary = daily.get(date);
    // Accepted source semantics: Garmin may supply minimum HR as restingValue's fallback.
    const heartRate = summary
      ? {
          calendarDate: summary.calendarDate,
          restingHeartRate: summary.heartRate?.restingValue ?? null,
        }
      : null;
    const nightlyHrv = hrv.get(date);
    rows.push(
      wellnessSchema.parse({
        ...normalizeWellness(
          date,
          heartRate,
          sleep.get(date) ?? null,
          nightlyHrv ? { hrvSummary: nightlyHrv } : null,
          weight,
        ),
        synced_at: new Date().toISOString(),
      }),
    );
  }
  return rows;
}
