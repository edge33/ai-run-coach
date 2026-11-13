import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Encoder,
  type EventMesg,
  type FileIdMesg,
  type LapMesg,
  Profile,
  type RecordMesg,
  type SessionMesg,
  type SplitMesg,
} from '@garmin/fitsdk';
import { zipSync } from 'fflate';
import type { z } from 'zod';
import { listActivities, normalizeSummary, normalizeWellness } from '../src/garmin/api.ts';
import { GarminClient, parseGarminJson } from '../src/garmin/client.ts';
import { GarminContractError } from '../src/garmin/errors.ts';
import { decodeActivityFile, segmentTiming } from '../src/garmin/fit.ts';
import { mapGarminRun } from '../src/garmin/import.ts';
import { garminResponses } from '../src/garmin/schemas.ts';
import { syntheticActivity } from './fixtures.ts';

const range = { start: '2026-10-19', end: '2026-10-24' };
const date = '2026-10-19';
const token = 'synthetic.access.token';
const activity = (id: number | string) => ({
  activityId: id,
  activityType: { typeKey: 'running' },
  startTimeLocal: `${date}T08:00:00`,
  description: 'discard this private text',
  startLatitude: 42,
});

function fakeClient(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  return new GarminClient('synthetic-key', {
    requestIntervalMs: 0,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://personal.connectapi.garmin.com');
      assert.equal(init?.redirect, 'error');
      if (init?.method === 'POST') {
        assert.equal(new Headers(init.headers).get('Authorization'), 'ApiKey synthetic-key');
        return new Response(token);
      }
      assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${token}`);
      return handler(url, init);
    },
  });
}

function fitFile(
  options: {
    backwards?: boolean;
    multiSession?: boolean;
    invalidLapTime?: boolean;
    overlappingSplit?: boolean;
  } = {},
) {
  const encoder = new Encoder();
  const start = new Date(`${date}T06:00:00Z`);
  const fileId: FileIdMesg = { type: 'activity', manufacturer: 'development' };
  encoder.onMesg(Profile.MesgNum.FILE_ID, fileId);
  const times = options.backwards ? [5, 4] : [5, 5, 65];
  for (const elapsed of times) {
    const record: RecordMesg = {
      timestamp: new Date(start.valueOf() + elapsed * 1000),
      distance: 0,
      heartRate: 150,
      power: 0,
      enhancedSpeed: 3,
      enhancedAltitude: -5,
      cadence: 85,
      fractionalCadence: 0.5,
      positionLat: 42,
    };
    encoder.onMesg(Profile.MesgNum.RECORD, record);
  }
  const lap: LapMesg = {
    startTime: start,
    timestamp: options.invalidLapTime ? start : new Date(start.valueOf() + 65000),
    totalElapsedTime: 65,
    totalTimerTime: 40,
    totalDistance: 100,
    intensity: 'active',
    lapTrigger: 'manual',
    wktStepIndex: 1,
  };
  encoder.onMesg(Profile.MesgNum.LAP, lap);
  const split: SplitMesg = {
    splitType: 'intervalActive',
    sport: 'running',
    startTime: start,
    endTime: new Date(start.valueOf() + 65000),
    totalElapsedTime: 65,
    totalTimerTime: 40,
    totalDistance: 100,
    firstLapIndex: 0,
    numLaps: 1,
  };
  if (options.overlappingSplit)
    encoder.onMesg(Profile.MesgNum.SPLIT, { ...split, splitType: 'rwdRun' } as SplitMesg);
  encoder.onMesg(Profile.MesgNum.SPLIT, split);
  const event: EventMesg = { timestamp: start, event: 'timer', eventType: 'start' };
  encoder.onMesg(Profile.MesgNum.EVENT, event);
  for (let index = 0; index < (options.multiSession ? 2 : 1); index++) {
    const session: SessionMesg = {
      startTime: start,
      timestamp: new Date(start.valueOf() + 65000),
      sport: 'running',
      totalElapsedTime: 65,
      totalTimerTime: 40,
      totalDistance: 100,
    };
    encoder.onMesg(Profile.MesgNum.SESSION, session);
  }
  return encoder.close();
}

test('Garmin JSON preserves large integer IDs exactly before rounding', () => {
  assert.deepEqual(parseGarminJson('{"activityId":9007199254740993,"distance":0}'), {
    activityId: '9007199254740993',
    distance: 0,
  });
  assert.throws(() => parseGarminJson('not json'), /INVALID_JSON/);
});

test('Garmin client authenticates once, handles 204, and never retries 429', async () => {
  let calls = 0;
  const client = fakeClient(() => {
    calls++;
    return calls === 1
      ? new Response(null, { status: 204 })
      : new Response('private error', { status: 429 });
  });
  assert.equal(await client.json('/hrv-service/hrv/2026-10-19', garminResponses.hrv), null);
  await assert.rejects(
    client.json('/hrv-service/hrv/2026-10-20', garminResponses.hrv),
    /^GarminError: HTTP_429$/,
  );
  assert.equal(calls, 2);
  assert.equal(client.requests, 3);
  assert.ok(!JSON.stringify(client).includes('synthetic-key'));
  assert.ok(!JSON.stringify(client).includes(token));
});

test('Garmin client sanitizes network errors and bounds streamed response bodies', async () => {
  const failed = fakeClient(() => {
    throw new Error('private credentials');
  });
  await assert.rejects(failed.json('/test', garminResponses.hrv), /^GarminError: NETWORK_ERROR$/);
  const large = fakeClient(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(16 * 1024 * 1024 + 1));
            controller.close();
          },
        }),
      ),
  );
  await assert.rejects(large.json('/test', garminResponses.hrv), /RESPONSE_TOO_LARGE/);
});

test('Garmin activity pagination traverses short pages and excludes private fields', async () => {
  const offsets: string[] = [];
  const client = fakeClient((url) => {
    const offset = url.searchParams.get('start') ?? '';
    offsets.push(offset);
    return Response.json(offset === '0' ? [activity(1)] : offset === '1' ? [activity(2)] : []);
  });
  const activities = await listActivities(client, range);
  assert.deepEqual(offsets, ['0', '1', '2']);
  assert.equal(activities.length, 2);
  assert.ok(!JSON.stringify(activities).includes('private text'));
  assert.ok(!JSON.stringify(activities).includes('startLatitude'));
});

test('Garmin activity pagination fails on repeated pages and out-of-range records', async () => {
  await assert.rejects(
    listActivities(
      fakeClient(() => Response.json([activity(1)])),
      range,
    ),
    /NON_ADVANCING/,
  );
  const outside = { ...activity(1), startTimeLocal: '2026-10-18T08:00:00' };
  await assert.rejects(
    listActivities(
      fakeClient(() => Response.json([outside])),
      range,
    ),
    /OUTSIDE_RANGE/,
  );
});

test('Garmin summaries keep elapsed, timer and moving durations separate, including zero and missing', () => {
  const result = normalizeSummary({
    elapsedDuration: 100,
    duration: 90,
    movingDuration: 80,
    averagePower: 0,
  });
  assert.equal(result.duration_s, 100);
  assert.equal(result.timer_time_s, 90);
  assert.equal(result.moving_time_s, 80);
  assert.equal(result.avg_power_w, 0);
  assert.equal(result.avg_hr_bpm, null);
  assert.throws(() => normalizeSummary({ distance: -1 }));
});

test('FIT decoding preserves pauses/gaps, duplicates, zero, negative altitude, laps and excludes GPS', () => {
  const decoded = decodeActivityFile(zipSync({ 'activity.fit': fitFile() }));
  assert.deepEqual(
    decoded.samples.map((sample) => sample.elapsed_s),
    [5, 5, 65],
  );
  assert.equal(decoded.samples[0].altitude_m, -5);
  assert.equal(decoded.samples[0].power_w, 0);
  assert.equal(decoded.samples[0].cadence_cycles_per_min, 85);
  assert.equal(decoded.samples[0].cadence_spm, 171);
  assert.equal(decoded.session.duration_s, 65);
  assert.equal(decoded.session.timer_time_s, 40);
  assert.equal(decoded.laps[0].start_time_s, 0);
  assert.equal(decoded.laps[0].end_time_s, 65);
  assert.equal(decoded.laps[0].intensity, 'active');
  assert.equal(decoded.laps[0].workout_step_index, 1);
  assert.equal(decoded.splits[0].split_type, 'intervalActive');
  assert.equal(decoded.splits[0].end_time_s, 65);
  assert.equal(decoded.splits[0].number_of_laps, 1);
  assert.deepEqual(decoded.timer_events, [{ elapsed_s: 0, event_type: 'start' }]);
  assert.ok(!JSON.stringify(decoded).includes('positionLat'));
});

test('FIT decoding rejects bad CRC, multiple sessions, backwards time, and ambiguous archives', () => {
  const damaged = fitFile();
  damaged[damaged.length - 1] ^= 1;
  assert.throws(() => decodeActivityFile(damaged), /INTEGRITY/);
  assert.throws(() => decodeActivityFile(fitFile({ multiSession: true })), /INVALID_FIT_DATA/);
  assert.throws(() => decodeActivityFile(fitFile({ backwards: true })), /BACKWARDS/);
  assert.throws(
    () => decodeActivityFile(zipSync({ 'one.fit': fitFile(), 'two.fit': fitFile() })),
    /ONE_FIT/,
  );
  assert.throws(() => decodeActivityFile(new Uint8Array([1, 2, 3])));
});

test('FIT laps retain invalid source timestamps without inventing end boundaries', () => {
  const lap = decodeActivityFile(fitFile({ invalidLapTime: true })).laps[0];
  assert.equal(lap.message_time_s, 0);
  assert.equal(lap.end_time_s, null);
  assert.equal(lap.timing_warning, 'LAP_TIMESTAMP_NOT_END');
  assert.equal(lap.duration_s, 65);
});

test('Garmin wellness selects nightly HRV and latest same-day kg weight without context carry-forward', () => {
  const weight = {
    dailyWeightSummaries: [{ summaryDate: date, latestWeight: { calendarDate: date, weight: 65 } }],
    previousDateWeight: { weight: 70 },
  };
  const result = normalizeWellness(
    date,
    { calendarDate: date, restingHeartRate: 0 },
    { calendarDate: date, sleepTimeSeconds: 100, napTimeSeconds: 50 },
    { hrvSummary: { calendarDate: date, lastNightAvg: 40, weeklyAvg: 55 } },
    weight,
  );
  assert.deepEqual(result, {
    date,
    resting_hr_bpm: 0,
    sleep_duration_s: 100,
    hrv_ms: 40,
    weight_kg: 65,
  });
  assert.equal(normalizeWellness('2026-10-20', null, null, null, weight).weight_kg, null);
  assert.throws(
    () =>
      normalizeWellness(
        '2026-10-20',
        { calendarDate: date, restingHeartRate: null },
        null,
        null,
        weight,
      ),
    /DATE_MISMATCH/,
  );
});

test('segment timing preserves source durations and flags differences beyond timestamp precision', () => {
  assert.equal(segmentTiming(0, 10, 9).timing_warning, null);
  assert.equal(segmentTiming(0, 10, 20).timing_warning, 'DURATION_TIMESTAMP_MISMATCH');
  assert.equal(segmentTiming(10, 5, 20).end_time_s, null);
  assert.equal(segmentTiming(10, null, 20).end_time_s, null);
  assert.throws(() => segmentTiming(-1, 10, 11));
});

test('Garmin storage mapping uses API totals, FIT laps/splits/samples and explicit nulls', () => {
  const result = mapGarminRun(
    {
      activityId: '1',
      activityTypeDTO: { typeKey: 'running' },
      summaryDTO: {
        startTimeLocal: `${date}T08:00:00.0`,
        distance: 1000,
        elapsedDuration: 100,
        duration: 80,
        movingDuration: 70,
      },
    },
    fitFile(),
    range,
  );
  assert.equal(result.run.duration_s, 100);
  assert.equal(result.run.timer_time_s, 80);
  assert.equal(result.run.moving_time_s, 70);
  assert.equal(result.run.start_time, `${date}T08:00:00`);
  assert.equal(result.splits[0].split_type, 'intervalActive');
  assert.equal(result.samples[0].cadence_spm, 171);
  assert.equal(Object.hasOwn(result.samples[0], 'raw_power_w'), false);
});

test('Garmin mapping excludes overlapping run/walk classifications without renumbering workout splits', () => {
  const mapped = mapGarminRun(
    {
      activityId: '1',
      activityTypeDTO: { typeKey: 'running' },
      summaryDTO: {
        startTimeLocal: `${date}T08:00:00`,
        distance: null,
        elapsedDuration: null,
        duration: null,
      },
    },
    fitFile({ overlappingSplit: true }),
    range,
  );
  assert.equal(mapped.splits.length, 1);
  assert.equal(mapped.splits[0].sequence, 1);
  assert.equal(mapped.splits[0].split_type, 'intervalActive');
  assert.equal(mapped.laps.length, 1);
});

test('Garmin JSON boundaries reject changed required fields and types with sanitized contract errors', async (t) => {
  const detail = syntheticActivity(date);
  const cases: { name: string; contract: { name: string; schema: z.ZodType }; invalid: unknown }[] =
    [
      {
        name: 'activity list envelope',
        contract: garminResponses.activities,
        invalid: { activities: [] },
      },
      {
        name: 'activity identity',
        contract: garminResponses.activities,
        invalid: [{ ...activity(1), activityId: null }],
      },
      {
        name: 'activity timestamp',
        contract: garminResponses.activities,
        invalid: [{ ...activity(1), startTimeLocal: '2026-02-30T08:00:00' }],
      },
      {
        name: 'detail envelope',
        contract: garminResponses.activity,
        invalid: { ...detail, summaryDTO: null },
      },
      {
        name: 'renamed distance',
        contract: garminResponses.activity,
        invalid: {
          ...detail,
          summaryDTO: { ...detail.summaryDTO, distance: undefined, distanceMeters: 5000 },
        },
      },
      {
        name: 'changed measurement type',
        contract: garminResponses.activity,
        invalid: { ...detail, summaryDTO: { ...detail.summaryDTO, averagePower: 'private value' } },
      },
      {
        name: 'daily renamed field',
        contract: garminResponses.daily,
        invalid: { calendarDate: date, restingHR: 50 },
      },
      {
        name: 'sleep changed type',
        contract: garminResponses.sleep,
        invalid: { calendarDate: date, sleepTimeSeconds: 'private value' },
      },
      { name: 'HRV changed nesting', contract: garminResponses.hrv, invalid: { lastNightAvg: 40 } },
      { name: 'weight envelope', contract: garminResponses.weight, invalid: { weights: [] } },
      {
        name: 'weight changed type',
        contract: garminResponses.weight,
        invalid: {
          dailyWeightSummaries: [
            { summaryDate: date, latestWeight: { calendarDate: date, weight: 'private value' } },
          ],
        },
      },
    ];
  for (const example of cases)
    await t.test(example.name, async () => {
      const client = fakeClient(() => Response.json(example.invalid));
      await assert.rejects(client.json('/synthetic', example.contract), (error: unknown) => {
        assert.ok(error instanceof GarminContractError);
        assert.equal(error.message, 'GARMIN_CONTRACT_CHANGED');
        assert.equal(error.contract, example.contract.name);
        assert.ok(error.issues.length);
        assert.ok(!JSON.stringify(error).includes('private value'));
        return true;
      });
    });
});

test('Garmin contracts allow additional fields, optional device readings, explicit nulls and empty wellness', async () => {
  const detail = syntheticActivity(date);
  const client = fakeClient(() =>
    Response.json({
      ...detail,
      description: 'private value',
      summaryDTO: { ...detail.summaryDTO, distance: null, averagePower: null, newMetric: 123 },
    }),
  );
  const result = await client.json('/synthetic', garminResponses.activity);
  assert.equal(result.summaryDTO.distance, null);
  assert.equal(result.summaryDTO.averagePower, null);
  assert.equal(result.summaryDTO.averageHR, null);
  assert.ok(!JSON.stringify(result).includes('private value'));
  assert.ok(!Object.hasOwn(result.summaryDTO, 'newMetric'));
  for (const contract of [garminResponses.daily, garminResponses.sleep, garminResponses.hrv]) {
    assert.equal(
      await fakeClient(() => new Response(null, { status: 204 })).json<unknown>(
        '/synthetic',
        contract,
      ),
      null,
    );
  }
  await assert.rejects(
    fakeClient(() => new Response(null, { status: 204 })).json(
      '/synthetic',
      garminResponses.activities,
    ),
    GarminContractError,
  );
});

test('Garmin token format changes fail safely before fetching activity data', async () => {
  let requests = 0;
  const client = new GarminClient('synthetic', {
    requestIntervalMs: 0,
    fetch: async () => {
      requests++;
      return Response.json({ access_token: 'private-token' });
    },
  });
  await assert.rejects(client.json('/synthetic', garminResponses.activities), (error: unknown) => {
    assert.ok(error instanceof GarminContractError);
    assert.equal(error.contract, 'token');
    assert.ok(!JSON.stringify(error).includes('private-token'));
    return true;
  });
  assert.equal(requests, 1);
});

test('sleep responses may omit their source date; present dates and measurements remain validated', async () => {
  for (const sleep of [
    { sleepTimeSeconds: 0 },
    { calendarDate: null, sleepTimeSeconds: 0 },
    { sleepTimeSeconds: 25000 },
    { calendarDate: date, sleepTimeSeconds: null },
  ]) {
    const parsed = await fakeClient(() => Response.json(sleep)).json(
      '/synthetic',
      garminResponses.sleep,
    );
    const value = normalizeWellness(date, null, parsed, null, { dailyWeightSummaries: [] });
    assert.equal(value.date, date);
    assert.equal(value.sleep_duration_s, sleep.sleepTimeSeconds);
  }
  assert.throws(
    () =>
      normalizeWellness(date, null, { calendarDate: '2026-10-20', sleepTimeSeconds: 100 }, null, {
        dailyWeightSummaries: [],
      }),
    /WELLNESS_DATE_MISMATCH/,
  );
  for (const input of [
    { calendarDate: 123, sleepTimeSeconds: 100 },
    { calendarDate: '2026-02-30', sleepTimeSeconds: 100 },
    { sleepTimeSeconds: 'private value' },
    { sleepTimeSeconds: -1 },
    {},
  ]) {
    await assert.rejects(
      fakeClient(() => Response.json(input)).json('/synthetic', garminResponses.sleep),
      GarminContractError,
    );
  }
});

test('contract diagnostics distinguish missing, null and wrong types without exposing source values', async () => {
  for (const [value, received] of [
    [undefined, 'undefined'],
    [null, 'null'],
    [123, 'number'],
  ] as const) {
    await assert.rejects(
      fakeClient(() => Response.json({ calendarDate: value, restingHeartRate: 50 })).json(
        '/synthetic',
        garminResponses.daily,
      ),
      (error: unknown) => {
        assert.ok(error instanceof GarminContractError);
        assert.deepEqual(error.issues, [
          { path: 'calendarDate', code: 'invalid_type', expected: 'string', received },
        ]);
        assert.ok(!JSON.stringify(error).includes('123'));
        return true;
      },
    );
  }
});
