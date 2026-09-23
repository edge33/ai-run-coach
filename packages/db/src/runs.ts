import { type DateRange, validateRange } from '@hub/contracts';
import type { IntervalRow, RunRow } from './schema.ts';
export const runColumns = [
  'id',
  'external_id',
  'name',
  'sport',
  'start_utc',
  'start_local',
  'local_date',
  'timezone',
  'indoor',
  'distance_m',
  'moving_time_s',
  'elapsed_time_s',
  'elevation_m',
  'avg_hr_bpm',
  'max_hr_bpm',
  'avg_cadence',
  'avg_power_w',
  'training_load',
  'source_hash',
  'snapshot_id',
  'synced_at',
  'details_status',
] as const;
const intervalColumns = [
  'run_id',
  'interval_index',
  'label',
  'distance_m',
  'moving_time_s',
  'elapsed_time_s',
  'avg_hr_bpm',
  'avg_power_w',
] as const;

import type { Kysely } from 'kysely';
import type { Database } from './schema.ts';

export class RunRepository {
  private readonly db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.db = db;
  }

  async listRuns(range: DateRange, limit = 50, offset = 0) {
    validateRange(range);
    const items = await this.db
      .selectFrom('runs')
      .select(runColumns)
      .where('local_date', '>=', range.start)
      .where('local_date', '<=', range.end)
      .orderBy('start_local', 'desc')
      .orderBy('id')
      .limit(limit)
      .offset(offset)
      .execute();
    const count = await this.db
      .selectFrom('runs')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('local_date', '>=', range.start)
      .where('local_date', '<=', range.end)
      .executeTakeFirstOrThrow();
    return { items, total: Number(count.count), limit, offset };
  }

  async getRun(id: string, intervalOffset = 0) {
    const run = await this.db
      .selectFrom('runs')
      .select(runColumns)
      .where('id', '=', id)
      .executeTakeFirst();
    if (!run) return null;
    const intervals = await this.db
      .selectFrom('run_intervals')
      .select(intervalColumns)
      .where('run_id', '=', id)
      .orderBy('interval_index')
      .limit(100)
      .offset(intervalOffset)
      .execute();
    const count = await this.db
      .selectFrom('run_intervals')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('run_id', '=', id)
      .executeTakeFirstOrThrow();
    return { run, intervals, interval_total: Number(count.count), interval_offset: intervalOffset };
  }

  async saveRun(run: RunRow, intervals: IntervalRow[] | null) {
    await this.db.transaction().execute(async (tx) => {
      const old = await tx
        .selectFrom('runs')
        .select(['id', 'details_status'])
        .where('external_id', '=', run.external_id)
        .executeTakeFirst();
      const id = old?.id ?? run.id;
      const row = { ...run, id };
      await tx
        .insertInto('runs')
        .values(row)
        .onConflict((oc) => oc.column('external_id').doUpdateSet(row))
        .execute();
      if (intervals !== null) {
        await tx.deleteFrom('run_intervals').where('run_id', '=', id).execute();
        for (const interval of intervals)
          await tx
            .insertInto('run_intervals')
            .values({ ...interval, run_id: id })
            .execute();
      }
    });
  }
}
