import { randomUUID } from 'node:crypto';
import {
  addDays,
  type DateRange,
  DEFAULT_SYNC_DAYS,
  localToday,
  MAX_SYNC_DAYS,
  type SyncRequest,
  type SyncRun,
  validateRange,
} from '@hub/contracts';
import type { Store } from '@hub/db';
import { z } from 'zod';
import type { Config } from './config.ts';
import { IntervalsClient, UpstreamError } from './intervals.ts';
import { activitySchema, mapActivity, mapWellness, runningTypes } from './mapping.ts';

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
  const ranges =
    request.mode === 'range'
      ? [validateRange({ start: request.start, end: request.end }, MAX_SYNC_DAYS)]
      : request.mode === 'all'
        ? await store.importedRanges()
        : [{ start: addDays(today, 1 - DEFAULT_SYNC_DAYS), end: today }];

  if (!ranges.length) ranges.push({ start: addDays(today, 1 - DEFAULT_SYNC_DAYS), end: today });

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

  const publish = async () => {
    await store.updateSync(id, run);
  };

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
    onRequest: async () => {
      await assertLease();
      run.requests++;
      await publish();
    },
  });

  let failedWindows = 0;

  try {
    for (const range of splitWindows(
      z.array(z.object({ start: z.string(), end: z.string() })).parse(JSON.parse(run.ranges_json)),
    )) {
      for (const resource of ['runs', 'health'] as const) {
        await assertLease();
        let rejectedInWindow = 0;

        try {
          const data =
            resource === 'runs'
              ? await client.activities(range.start, range.end)
              : await client.wellness(range.start, range.end);

          const rows = z.array(z.unknown()).max(20000).parse(data);

          for (const row of rows) {
            await assertLease();
            run.received++;

            try {
              if (resource === 'runs') {
                const basic = z
                  .object({ type: z.string().optional() })
                  .passthrough()
                  .safeParse(row);

                if (basic.success && basic.data.type && !runningTypes.has(basic.data.type))
                  continue;

                const summary = activitySchema.parse(row);

                if (
                  summary.start_date_local.slice(0, 10) < range.start ||
                  summary.start_date_local.slice(0, 10) > range.end
                )
                  throw new Error('OUT_OF_RANGE');

                let mapped: ReturnType<typeof mapActivity>;

                try {
                  const detail = await client.activity(summary.id);
                  const parsed = activitySchema.parse(detail);

                  if (parsed.id !== summary.id) throw new Error('ID_MISMATCH');

                  mapped = mapActivity({ ...summary, ...parsed }, true);
                } catch {
                  rejectedInWindow++;
                  run.rejected++;
                  await store.issue(id, resource, 'DETAIL_UNAVAILABLE', summary.id);
                  continue;
                }

                await assertLease();
                await store.saveRun(mapped.run, mapped.intervals);
              } else {
                const mapped = mapWellness(row);

                if (mapped.date < range.start || mapped.date > range.end)
                  throw new Error('OUT_OF_RANGE');

                await store.saveWellness(mapped);
              }

              run.upserted++;
            } catch {
              run.rejected++;
              rejectedInWindow++;
              await store.issue(id, resource, 'RECORD_INVALID_OR_RESTRICTED');
            }
          }

          await assertLease();

          if (rejectedInWindow === 0)
            await store.markCoverage({
              ...range,
              resource,
              synced_at: new Date().toISOString(),
              run_id: id,
            });
          else failedWindows++;
        } catch (error) {
          failedWindows++;
          const code = error instanceof UpstreamError ? error.code : 'WINDOW_FAILED';
          run.error_code = code;
          await store.issue(id, resource, code);
        }

        options.signal?.throwIfAborted();
        run.completed_windows++;
        await publish();
      }
    }

    run.status =
      failedWindows === 0
        ? 'completed'
        : run.upserted > 0 || failedWindows < run.total_windows
          ? 'partial'
          : 'failed';

    if (run.rejected && !run.error_code) run.error_code = 'SOME_RECORDS_UNAVAILABLE';
  } catch {
    run.status = 'interrupted';
    run.error_code = 'WORKER_INTERRUPTED';
  } finally {
    clearInterval(heartbeat);
    run.completed_at = new Date().toISOString();

    try {
      await publish();
    } finally {
      await store.releaseLease(id);
    }
  }

  return run;
}
