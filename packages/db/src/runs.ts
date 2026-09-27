import { addDays, type DateRange, validateRange } from '@hub/contracts';
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
  'max_power_w',
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
  'elevation_loss_m',
  'avg_cadence_rpm',
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
      .where('start_time', '>=', range.start)
      .where('start_time', '<', addDays(range.end, 1))
      .orderBy('start_time', 'desc')
      .orderBy('id')
      .limit(limit)
      .offset(offset)
      .execute();
    const count = await this.db
      .selectFrom('runs')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('start_time', '>=', range.start)
      .where('start_time', '<', addDays(range.end, 1))
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
    await this.db.transaction().execute(async (tx) => {
      await tx
        .insertInto('runs')
        .values(run)
        .onConflict((oc) => oc.column('id').doUpdateSet(run))
        .execute();
      if (intervals !== null) {
        await tx.deleteFrom('run_intervals').where('run_id', '=', run.id).execute();
        for (const interval of intervals)
          await tx
            .insertInto('run_intervals')
            .values({ ...interval, run_id: run.id })
            .execute();
      }
    });
  }
}
