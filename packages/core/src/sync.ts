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
import { z } from 'zod';
import { type Config, logger } from './config.ts';
import { IntervalsClient, UpstreamError } from './intervals.ts';
import { activitySchema, mapActivity, mapWellness, runningTypes } from './mapping.ts';
import { mapRunStreams } from './streams.ts';

export function splitWindows(ranges: DateRange[]): DateRange[] {
  return ranges.flatMap((range) => {
    const windows: DateRange[] = [];

    for (let start = range.start; start <= range.end; start = addDays(start, 90)) {
      const end = addDays(start, 89);
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
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
) {
  const run = await store.syncRun(id);
  if (run?.status !== 'running') throw new Error('SYNC_NOT_RUNNING');

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
  const client = new IntervalsClient({
    apiKey: config.apiKey,
    athleteId: config.athleteId,
    fetch: options.fetch,
    signal: options.signal,
    retry: false,
    onRequest: async () => {
      await assertLease();
      run.requests++;
      await publish();
    },
  });

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
    await staged.migrate();
    const ranges = z
      .array(z.object({ start: z.string(), end: z.string() }))
      .parse(JSON.parse(run.ranges_json));
    for (const range of splitWindows(ranges)) {
      for (resource of ['runs', 'health'] as const) {
        await assertLease();
        recordRef = null;
        errorCode = 'WINDOW_FAILED';
        const data =
          resource === 'runs'
            ? await client.activities(range.start, range.end)
            : await client.wellness(range.start, range.end);
        const rows = z.array(z.unknown()).max(20000).parse(data);
        for (const row of rows) {
          await assertLease();
          run.received++;
          inRecord = true;
          recordRef = null;
          errorCode = 'RECORD_INVALID_OR_RESTRICTED';
          if (resource === 'runs') {
            const basic = z.object({ type: z.string().optional() }).safeParse(row);
            if (basic.success && basic.data.type && !runningTypes.has(basic.data.type)) {
              inRecord = false;
              continue;
            }
            const summary = activitySchema.parse(row);
            recordRef = summary.id;
            if (
              summary.start_date_local.slice(0, 10) < range.start ||
              summary.start_date_local.slice(0, 10) > range.end
            )
              throw new Error('OUT_OF_RANGE');
            errorCode = 'DETAIL_UNAVAILABLE';
            const parsed = activitySchema.parse(await client.activity(summary.id));
            if (parsed.id !== summary.id) throw new Error('ID_MISMATCH');
            const mapped = mapActivity({ ...summary, ...parsed }, true);
            errorCode = 'STREAMS_UNAVAILABLE';
            const samples = mapRunStreams(summary.id, await client.streams(summary.id));
            await assertLease();
            errorCode = 'RECORD_INVALID_OR_RESTRICTED';
            await staged.saveRun(mapped.run, mapped.intervals, samples);
          } else {
            const mapped = mapWellness(row);
            recordRef = mapped.date;
            if (mapped.date < range.start || mapped.date > range.end)
              throw new Error('OUT_OF_RANGE');
            await staged.saveWellness(mapped);
          }
          stagedCount++;
          inRecord = false;
        }
        coverage.push({ ...range, resource, synced_at: new Date().toISOString(), run_id: id });
        run.completed_windows++;
        await publish();
      }
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
        : error instanceof UpstreamError && errorCode === 'WINDOW_FAILED'
          ? error.code
          : errorCode;
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
          logger.warn({ code: 'STAGING_CLEANUP_FAILED' }, 'Unable to remove temporary import data');
        }
      }
    }
  }
  return run;
}
