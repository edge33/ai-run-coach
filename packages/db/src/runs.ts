import { addDays, type DateRange, intervalSchema, runSchema, validateRange } from '@hub/contracts';
import type { IntervalRow, RunRow } from './schema.ts';
export const runColumns = [
  'id',
  'start_time',
  'indoor',
  'distance_m',
  'duration_s',
  'moving_time_s',
  'avg_speed_mps',
  'max_speed_mps',
  'avg_hr_bpm',
  'max_hr_bpm',
  'avg_power_w',
  'elevation_gain_m',
  'elevation_loss_m',
  'avg_cadence_rpm',
  'training_load',
  'synced_at',
  'details_status',
] as const;
const intervalColumns = [
  'run_id',
  'sequence',
  'interval_type',
  'duration_s',
  'distance_m',
  'avg_speed_mps',
  'max_speed_mps',
  'avg_hr_bpm',
  'max_hr_bpm',
  'avg_power_w',
  'max_power_w',
  'elevation_gain_m',
  'avg_cadence_rpm',
] as const;

import type { Kysely } from 'kysely';
import type { Database } from './schema.ts';

export class RunRepository {
  private readonly db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.db = db;
  }

  async listRuns(range?: DateRange, limit = 50, offset = 0) {
    if (range) validateRange(range);
    const endExclusive = !range || range.end === '9999-12-31' ? null : addDays(range.end, 1);
    let itemsQuery = this.db.selectFrom('runs').select(runColumns);
    if (range) itemsQuery = itemsQuery.where('start_time', '>=', range.start);
    if (endExclusive) itemsQuery = itemsQuery.where('start_time', '<', endExclusive);
    const items = await itemsQuery
      .orderBy('start_time', 'desc')
      .orderBy('id')
      .limit(limit)
      .offset(offset)
      .execute();
    let countQuery = this.db
      .selectFrom('runs')
      .select((eb) => eb.fn.countAll<number>().as('count'));
    if (range) countQuery = countQuery.where('start_time', '>=', range.start);
    if (endExclusive) countQuery = countQuery.where('start_time', '<', endExclusive);
    const count = await countQuery.executeTakeFirstOrThrow();
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
      .orderBy('sequence')
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
    const validRun = runSchema.parse(run);
    const validIntervals = intervals?.map((interval) => intervalSchema.parse(interval)) ?? null;
    await this.db.transaction().execute(async (tx) => {
      await tx
        .insertInto('runs')
        .values(validRun)
        .onConflict((oc) => oc.column('id').doUpdateSet(validRun))
        .execute();
      if (validIntervals !== null) {
        await tx.deleteFrom('run_intervals').where('run_id', '=', validRun.id).execute();
        for (const interval of validIntervals)
          await tx
            .insertInto('run_intervals')
            .values({ ...interval, run_id: validRun.id })
            .execute();
      }
    });
  }
}
