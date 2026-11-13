import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addDays,
  type Coverage,
  type DateRange,
  localToday,
  MAX_SYNC_DAYS,
  type SyncRequest,
  type SyncRun,
  syncRequestSchema,
  validateRange,
} from '@hub/contracts';
import { Store } from '@hub/db';
import type { Logger } from 'pino';
import { z } from 'zod';
import { type Config, logger } from './config.ts';
import { listActivities, runningTypes } from './garmin/api.ts';
import { GarminClient, GarminError } from './garmin/client.ts';
import { GarminContractError } from './garmin/errors.ts';
import { fetchGarminWellnessRange, mapGarminRun } from './garmin/import.ts';
import type { GarminRequestGate } from './garmin/request-gate.ts';
import { garminResponses } from './garmin/schemas.ts';

export function splitWindows(ranges: DateRange[]): DateRange[] {
  return ranges.flatMap((range) => {
    const windows: DateRange[] = [];

    for (let start = range.start; start <= range.end; start = addDays(start, 31)) {
      const end = addDays(start, 30);
      windows.push({ start, end: end < range.end ? end : range.end });
    }

    return windows;
  });
}

export class SyncBusyError extends Error {
  constructor() {
    super('A sync is already running');
  }
}

export async function beginSync(
  store: Store,
  request: SyncRequest,
  timezone: string,
): Promise<SyncRun> {
  const today = localToday(timezone);
  const input = syncRequestSchema.parse(request);
  const ranges = [validateRange({ start: input.start, end: input.end }, MAX_SYNC_DAYS)];

  if (ranges.some((range) => range.end > today))
    throw new Error('Future dates cannot be synchronized');

  const id = randomUUID();

  if (!(await store.acquireLease(id))) throw new SyncBusyError();

  try {
    await store.recoverInterrupted();

    const run: SyncRun = {
      id,
      mode: request.mode,
      start: ranges[0].start,
      end: ranges.at(-1)?.end ?? today,
      ranges_json: JSON.stringify(ranges),
      status: 'running',
      started_at: new Date().toISOString(),
      completed_at: null,
      received: 0,
      upserted: 0,
      rejected: 0,
      requests: 0,
      completed_windows: 0,
      total_windows: splitWindows(ranges).length * 2,
      error_code: null,
    };

    await store.createSync(run);

    return run;
  } catch (error) {
    await store.releaseLease(id);
    throw error;
  }
}

export async function executeSync(
  store: Store,
  config: Config,
  id: string,
  options: {
    fetch?: typeof fetch;
    signal?: AbortSignal;
    logger?: Logger;
    gate?: GarminRequestGate;
  } = {},
) {
  const run = await store.syncRun(id);
  if (run?.status !== 'running') throw new Error('SYNC_NOT_RUNNING');

  const log = (options.logger ?? logger).child({ sync_id: id });
  const started = performance.now();
  const progress = () => ({
    requests: run.requests,
    received: run.received,
    upserted: run.upserted,
    completed_windows: run.completed_windows,
    total_windows: run.total_windows,
    duration_ms: Math.round(performance.now() - started),
  });
  log.info({ event: 'sync_started', total_windows: run.total_windows }, 'Garmin import started');

  let leaseLost = false;
  const heartbeat = setInterval(() => {
    void store
      .renewLease(id)
      .then((ok) => {
        if (!ok) leaseLost = true;
      })
      .catch(() => {
        leaseLost = true;
      });
  }, 10000);
  const publish = () => store.updateSync(id, run);
  const assertLease = async () => {
    options.signal?.throwIfAborted();
    if (leaseLost) throw new Error('LEASE_LOST');
    await store.assertLease(id);
  };

  let staged: Store | undefined;
  let directory: string | undefined;
  let resource: 'runs' | 'health' = 'runs';
  let recordRef: string | null = null;
  let inRecord = false;
  let errorCode = 'IMPORT_FAILED';
  let stagedCount = 0;
  const coverage: Coverage[] = [];

  try {
    // Only normalized rows are staged. Live measurements change only after every request succeeds.
    directory = await mkdtemp(join(tmpdir(), 'hub-import-'));
    staged = new Store(join(directory, 'staged.sqlite'));
    await staged.initialize();
    const ranges = z
      .array(z.object({ start: z.string(), end: z.string() }))
      .parse(JSON.parse(run.ranges_json));
    const client = new GarminClient(config.apiKey, {
      fetch: options.fetch,
      logger: log,
      gate: options.gate,
      requestIntervalMs: config.garminRequestIntervalMs,
      signal: options.signal,
      onRequest: async () => {
        await assertLease();
        run.requests++;
        await publish();
      },
    });
    for (const range of splitWindows(ranges)) {
      resource = 'runs';
      recordRef = null;
      errorCode = 'WINDOW_FAILED';
      const activities = await listActivities(client, range, 20000);
      log.info(
        { event: 'sync_activities_listed', activities: activities.length, ...progress() },
        'Garmin activity listing complete',
      );
      for (const activity of activities) {
        if (!runningTypes.has(activity.activityType.typeKey)) continue;
        await assertLease();
        inRecord = true;
        run.received++;
        recordRef = activity.activityId;
        errorCode = 'DETAIL_UNAVAILABLE';
        const detail = await client.json(
          `/activity-service/activity/${activity.activityId}`,
          garminResponses.activity,
        );
        if (
          detail.activityId !== activity.activityId ||
          detail.activityTypeDTO.typeKey !== activity.activityType.typeKey
        ) {
          throw new GarminError('ACTIVITY_DETAIL_MISMATCH');
        }
        errorCode = 'FILE_UNAVAILABLE';
        const file = await client.activityFile(activity.activityId);
        errorCode = 'RECORD_INVALID_OR_RESTRICTED';
        const mapped = mapGarminRun(detail, file, range);
        if (mapped.run.id !== activity.activityId) throw new Error('ID_MISMATCH');
        await assertLease();
        await staged.saveRun(mapped.run, mapped.laps, mapped.splits, mapped.samples);
        stagedCount++;
        inRecord = false;
      }
      coverage.push({ ...range, resource, synced_at: new Date().toISOString(), run_id: id });
      run.completed_windows++;
      await publish();
      log.info(
        { event: 'sync_progress', resource, staged: stagedCount, ...progress() },
        'Garmin import resource window staged',
      );
      resource = 'health';
      recordRef = null;
      errorCode = 'WINDOW_FAILED';
      const weight = await client.json(
        `/weight-service/weight/range/${range.start}/${range.end}`,
        garminResponses.weight,
      );
      const wellness = await fetchGarminWellnessRange(client, range, weight);
      for (const row of wellness) {
        await assertLease();
        inRecord = true;
        run.received++;
        recordRef = row.date;
        errorCode = 'RECORD_INVALID_OR_RESTRICTED';
        await staged.saveWellness(row);
        stagedCount++;
        inRecord = false;
      }
      coverage.push({ ...range, resource, synced_at: new Date().toISOString(), run_id: id });
      run.completed_windows++;
      await publish();
      log.info(
        { event: 'sync_progress', resource, staged: stagedCount, ...progress() },
        'Garmin import resource window staged',
      );
    }
    await assertLease();
    errorCode = 'IMPORT_COMMIT_FAILED';
    recordRef = null;
    // No network requests remain. Renew the lease inside the short atomic publication transaction.
    clearInterval(heartbeat);
    run.status = 'completed';
    run.upserted = stagedCount;
    run.completed_at = new Date().toISOString();
    await store.commitImport(staged, run, coverage, options.signal);
  } catch (error) {
    const lostLease = error instanceof Error && error.message === 'LEASE_LOST';
    const interrupted = options.signal?.aborted || lostLease;
    run.status = interrupted ? 'interrupted' : 'failed';
    run.upserted = 0;
    run.rejected = !interrupted && inRecord ? 1 : 0;
    run.error_code = lostLease
      ? 'LEASE_LOST'
      : interrupted
        ? 'WORKER_INTERRUPTED'
        : error instanceof GarminError
          ? error.message
          : errorCode;
    const details = {
      event: 'sync_failed',
      code: run.error_code,
      status: run.status,
      resource,
      ...progress(),
      ...(error instanceof GarminContractError
        ? { contract: error.contract, issues: error.issues }
        : {}),
    };
    if (interrupted) log.warn(details, 'Garmin import interrupted; no data published');
    else log.error(details, 'Garmin import failed; no data published');
    await store.issue(id, resource, run.error_code, recordRef);
  } finally {
    clearInterval(heartbeat);
    try {
      if (run.status !== 'completed') {
        run.completed_at = new Date().toISOString();
        await publish();
      }
    } finally {
      try {
        await store.releaseLease(id);
      } finally {
        try {
          await staged?.close();
          if (directory) await rm(directory, { recursive: true, force: true });
        } catch {
          log.warn({ code: 'STAGING_CLEANUP_FAILED' }, 'Unable to remove temporary import data');
        }
      }
    }
  }
  if (run.status === 'completed') {
    log.info({ event: 'sync_completed', ...progress() }, 'Garmin import completed');
  }
  return run;
}
