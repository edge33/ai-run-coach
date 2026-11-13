// Development-only source investigation; application imports use api.ts and import.ts.
import { addDays, type DateRange, validateRange } from '@hub/contracts';
import { listActivities, normalizeSummary, normalizeWellness, runningTypes } from './api.ts';
import { type GarminClient, GarminError } from './client.ts';
import { decodeActivityFile } from './fit.ts';
import { garminResponses } from './schemas.ts';

export async function exploreGarmin(client: GarminClient, input: DateRange) {
  const range = validateRange(input, 31);
  const activities = await listActivities(client, range);
  const activityDetails = [];
  const runs = [];
  for (const activity of activities) {
    const id = activity.activityId;
    const detail = await client.json(`/activity-service/activity/${id}`, garminResponses.activity);
    if (
      detail.activityId !== id ||
      detail.activityTypeDTO.typeKey !== activity.activityType.typeKey
    ) {
      throw new GarminError('ACTIVITY_DETAIL_MISMATCH');
    }
    const date = detail.summaryDTO.startTimeLocal.slice(0, 10);
    if (date < range.start || date > range.end) throw new GarminError('ACTIVITY_OUTSIDE_RANGE');
    const isRun = runningTypes.has(detail.activityTypeDTO.typeKey);
    activityDetails.push({
      id,
      type: detail.activityTypeDTO.typeKey,
      start_time_local: detail.summaryDTO.startTimeLocal,
      extracted_run: isRun,
      summary: normalizeSummary(detail.summaryDTO),
    });
    if (!isRun) continue;
    const structuredWorkouts = await client.json(
      `/activity-service/activity/${id}/workouts`,
      garminResponses.workouts,
    );
    const fit = decodeActivityFile(await client.activityFile(id));
    if (fit.sport !== 'running') throw new GarminError('FIT_SPORT_MISMATCH');
    const startGMT = detail.summaryDTO.startTimeGMT;
    if (
      startGMT &&
      Math.abs(Date.parse(`${startGMT.replace(' ', 'T')}Z`) - Date.parse(fit.start_time_utc)) > 1000
    ) {
      throw new GarminError('FIT_START_TIME_MISMATCH');
    }
    runs.push({
      id,
      activity_type: detail.activityTypeDTO.typeKey,
      start_time_local: detail.summaryDTO.startTimeLocal,
      summary: normalizeSummary(detail.summaryDTO),
      api_split_summaries: (detail.splitSummaries ?? []).map((split) => ({
        split_type: split.splitType ?? null,
        number_of_splits: split.noOfSplits ?? null,
        ...normalizeSummary(split),
      })),
      structured_workouts: structuredWorkouts,
      fit,
    });
  }
  const weight = await client.json(
    `/weight-service/weight/range/${range.start}/${range.end}`,
    garminResponses.weight,
  );
  const wellness = [];
  for (let date = range.start; date <= range.end; date = addDays(date, 1)) {
    const daily = await client.json(
      `/usersummary-service/usersummary/daily?${new URLSearchParams({ calendarDate: date })}`,
      garminResponses.daily,
    );
    const sleep = await client.json(
      `/sleep-service/sleep/dailySleep?${new URLSearchParams({ date })}`,
      garminResponses.sleep,
    );
    const hrv = await client.json(`/hrv-service/hrv/${date}`, garminResponses.hrv);
    wellness.push(normalizeWellness(date, daily, sleep, hrv, weight));
  }
  return {
    source: 'garmin_connect_personal_api',
    mapping_version: 'exploration-4',
    range,
    extracted_at: new Date().toISOString(),
    activities: activityDetails,
    runs,
    wellness,
    requests: client.requests,
    rate_limits: client.rateLimits,
    limitations: [
      'Exploration only; no application database or coverage updated.',
      'Planned steps, API aggregate splits, recorded FIT laps, and individual FIT splits are separate evidence.',
      'FIT steps/minute is twice the sum of cadence and fractional cadence; source components are retained.',
      'FIT timer time is not assumed to be moving time.',
      'Impossible lap end timestamps become null with a boundary issue; original message time is retained.',
      'Source split elapsed durations and timestamp spans may differ; neither is silently reconstructed.',
      'No HR-message merging or developer-field power substitution is performed.',
      'Unknown activity subtypes are listed but not silently treated as supported runs.',
      'Wellness weight uses the latest same-day entry, in documented kilograms; sleep excludes naps.',
      'Historical completeness and field semantics require live review.',
    ],
  };
}
