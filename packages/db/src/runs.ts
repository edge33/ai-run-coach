import {
  addDays,
  type DateRange,
  intervalSchema,
  MAX_RUN_SAMPLES,
  type RunSample,
  runSampleSchema,
  runSchema,
  sampleQuerySchema,
  validateRange,
} from '@hub/contracts';
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
  'power_source',
  'samples_synced_at',
] as const;
const intervalColumns = [
  'run_id',
  'sequence',
  'interval_type',
  'label',
  'start_index',
  'end_index',
  'start_time_s',
  'end_time_s',
  'moving_time_s',
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
    return this.db.transaction().execute(async (tx) => {
      const run = await tx
        .selectFrom('runs')
        .select(runColumns)
        .where('id', '=', id)
        .executeTakeFirst();
      if (!run) return null;
      const intervals = await tx
        .selectFrom('run_intervals')
        .select(intervalColumns)
        .where('run_id', '=', id)
        .orderBy('sequence')
        .limit(100)
        .offset(intervalOffset)
        .execute();
      const count = await tx
        .selectFrom('run_intervals')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('run_id', '=', id)
        .executeTakeFirstOrThrow();
      return {
        run,
        intervals,
        interval_total: Number(count.count),
        interval_offset: intervalOffset,
      };
    });
  }

  async getRunSamples(id: string, limit = 100, offset = 0) {
    sampleQuerySchema.parse({ limit, offset });
    return this.db.transaction().execute(async (tx) => {
      const run = await tx
        .selectFrom('runs')
        .select(['id', 'power_source', 'samples_synced_at'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!run) return null;
      const items = await tx
        .selectFrom('run_samples')
        .selectAll()
        .where('run_id', '=', id)
        .orderBy('sample_index')
        .limit(limit)
        .offset(offset)
        .execute();
      const count = await tx
        .selectFrom('run_samples')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('run_id', '=', id)
        .executeTakeFirstOrThrow();
      return {
        run_id: id,
        power_source: run.power_source,
        synced_at: run.samples_synced_at,
        items,
        total: Number(count.count),
        limit,
        offset,
      };
    });
  }

  async saveRun(run: RunRow, intervals: IntervalRow[] | null, samples: RunSample[] | null = null) {
    const validRun = runSchema.parse(run);
    const validIntervals = intervals?.map((interval) => intervalSchema.parse(interval)) ?? null;
    if (samples && samples.length > MAX_RUN_SAMPLES) throw new Error('TOO_MANY_SAMPLES');
    const validSamples = samples?.map((sample) => runSampleSchema.parse(sample)) ?? null;
    for (const [index, sample] of (validSamples ?? []).entries()) {
      if (
        sample.run_id !== validRun.id ||
        sample.sample_index !== index ||
        (index > 0 && sample.elapsed_s < (validSamples?.[index - 1].elapsed_s ?? 0))
      )
        throw new Error('INVALID_SAMPLE_SEQUENCE');
    }
    for (const interval of validIntervals ?? []) {
      if (
        interval.run_id !== validRun.id ||
        (interval.start_index !== null &&
          interval.end_index !== null &&
          interval.start_index > interval.end_index) ||
        (interval.start_time_s !== null &&
          interval.end_time_s !== null &&
          interval.start_time_s > interval.end_time_s) ||
        (validSamples?.length &&
          ((interval.start_index ?? 0) > validSamples.length ||
            (interval.end_index ?? 0) > validSamples.length))
      )
        throw new Error('INVALID_INTERVAL_BOUNDARY');
    }
    const updates: Partial<RunRow> = { ...validRun };
    if (validSamples === null) {
      delete updates.samples_synced_at;
      delete updates.power_source;
    } else {
      validRun.samples_synced_at = validRun.synced_at;
      updates.samples_synced_at = validRun.synced_at;
    }
    const save = async (tx: Kysely<Database>) => {
      await tx
        .insertInto('runs')
        .values(validRun)
        .onConflict((oc) => oc.column('id').doUpdateSet(updates))
        .execute();
      if (validIntervals !== null) {
        await tx.deleteFrom('run_intervals').where('run_id', '=', validRun.id).execute();
        for (const interval of validIntervals)
          await tx
            .insertInto('run_intervals')
            .values({ ...interval, run_id: validRun.id })
            .execute();
      }
      if (validSamples !== null) {
        await tx.deleteFrom('run_samples').where('run_id', '=', validRun.id).execute();
        // Bound SQLite parameters and avoid one awaited insert per second of a long run.
        for (let index = 0; index < validSamples.length; index += 50)
          await tx
            .insertInto('run_samples')
            .values(validSamples.slice(index, index + 50))
            .execute();
      }
    };
    if (this.db.isTransaction) await save(this.db);
    else await this.db.transaction().execute(save);
  }
}
