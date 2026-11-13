import {
  Encoder,
  type FileIdMesg,
  type LapMesg,
  Profile,
  type RecordMesg,
  type SessionMesg,
  type SplitMesg,
} from '@garmin/fitsdk';
import { addDays, type Run, runSchema, type Wellness, wellnessSchema } from '@hub/contracts';

export function syntheticRun(overrides: Partial<Run> = {}) {
  return runSchema.parse({
    id: '123',
    start_time: '2026-09-20T08:00:00',
    distance_m: 5000,
    duration_s: 1900,
    timer_time_s: 1850,
    moving_time_s: 1800,
    elevation_gain_m: 20,
    synced_at: '2026-09-20T10:00:00Z',
    ...overrides,
  });
}
export function syntheticWellness(overrides: Partial<Wellness> = {}) {
  return wellnessSchema.parse({
    date: '2026-09-20',
    synced_at: '2026-09-20T10:00:00Z',
    ...overrides,
  });
}
export function syntheticActivity(date = '2026-09-20', distance = 5000, id = '123') {
  return {
    activityId: id,
    activityTypeDTO: { typeKey: 'running' },
    summaryDTO: {
      startTimeLocal: `${date}T08:00:00.0`,
      startTimeGMT: `${date}T08:00:00.0`,
      distance,
      elapsedDuration: 1900,
      duration: 1850,
      movingDuration: 1800,
      elevationGain: 20,
      averagePower: 220,
      averageRunCadence: 160,
    },
  };
}
export function syntheticFit(date = '2026-09-20') {
  const encoder = new Encoder();
  const start = new Date(`${date}T08:00:00Z`);
  const end = new Date(start.valueOf() + 10000);
  const file: FileIdMesg = { type: 'activity', manufacturer: 'development' };
  encoder.onMesg(Profile.MesgNum.FILE_ID, file);
  for (const [index, elapsed] of [0, 1, 5].entries()) {
    const record: RecordMesg = {
      timestamp: new Date(start.valueOf() + elapsed * 1000),
      distance: elapsed * 3,
      enhancedSpeed: 3,
      heartRate: index === 1 ? undefined : 140,
      power: index === 0 ? 0 : 220,
      enhancedAltitude: -5,
      cadence: 80,
    };
    encoder.onMesg(Profile.MesgNum.RECORD, record);
  }
  const lap: LapMesg = {
    startTime: start,
    timestamp: end,
    totalElapsedTime: 10,
    totalTimerTime: 8,
    totalDistance: 30,
    avgPower: 250,
    maxPower: 400,
    intensity: 'active',
    lapTrigger: 'manual',
  };
  encoder.onMesg(Profile.MesgNum.LAP, lap);
  const split: SplitMesg = {
    startTime: start,
    endTime: end,
    splitType: 'intervalActive',
    totalElapsedTime: 10,
    totalTimerTime: 8,
    totalDistance: 30,
    firstLapIndex: 0,
    numLaps: 1,
  };
  encoder.onMesg(Profile.MesgNum.SPLIT, split);
  const session: SessionMesg = {
    startTime: start,
    timestamp: end,
    sport: 'running',
    totalElapsedTime: 10,
  };
  encoder.onMesg(Profile.MesgNum.SESSION, session);
  return encoder.close();
}

export function garminFetch(
  options: {
    date?: string;
    id?: string;
    distance?: number;
    restingHR?: number;
    empty?: boolean;
  } = {},
): typeof fetch {
  const date = options.date ?? '2026-09-20';
  const detail = syntheticActivity(date, options.distance, options.id);
  return async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://personal.connectapi.garmin.com') throw new Error('Unexpected host');
    if (init?.method === 'POST') return new Response('synthetic.access.token');
    if (url.pathname.includes('/search/activities'))
      return Response.json(
        options.empty || url.searchParams.get('start') !== '0'
          ? []
          : [
              {
                activityId: detail.activityId,
                activityType: detail.activityTypeDTO,
                startTimeLocal: detail.summaryDTO.startTimeLocal,
              },
            ],
      );
    if (url.pathname.includes('/files/activity/'))
      return new Response(Buffer.from(syntheticFit(date)));
    if (url.pathname.startsWith('/activity-service/activity/')) return Response.json(detail);
    if (url.pathname.includes('/weight/range/')) return Response.json({ dailyWeightSummaries: [] });
    if (url.pathname.includes('/hrv/')) return new Response(null, { status: 204 });
    if (url.pathname === '/usersummary-service/v2/dailysummaries') {
      const data = [];
      const end = url.searchParams.get('endDate') as string;
      for (
        let date = url.searchParams.get('startDate') as string;
        date <= end;
        date = addDays(date, 1)
      ) {
        data.push({ calendarDate: date, heartRate: { restingValue: options.restingHR ?? 50 } });
      }
      return Response.json({ data });
    }
    if (url.pathname.includes('/usersummary/daily'))
      return Response.json({
        calendarDate: url.searchParams.get('calendarDate'),
        restingHeartRate: options.restingHR ?? 50,
      });
    if (url.pathname.includes('/sleep/dailySleepSummariesByDate')) {
      const rows = [];
      const end = url.searchParams.get('endDate') as string;
      for (
        let date = url.searchParams.get('startDate') as string;
        date <= end;
        date = addDays(date, 1)
      ) {
        rows.push({ calendarDate: date, sleepTimeSeconds: 25000 });
      }
      return Response.json(rows);
    }
    if (url.pathname.includes('/sleep/dailySleep'))
      return Response.json({ calendarDate: url.searchParams.get('date'), sleepTimeSeconds: 25000 });
    throw new Error('Unexpected Garmin endpoint');
  };
}
