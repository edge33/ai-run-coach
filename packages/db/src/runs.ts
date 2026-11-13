import {
  addDays,
  DATA_SOURCE,
  type DateRange,
  lapSchema,
  MAX_RUN_SAMPLES,
  type RunLap,
  type RunSample,
  type RunSplit,
  runDetailQuerySchema,
  runSampleSchema,
  runSchema,
  sampleQuerySchema,
  splitSchema,
  validateRange,
} from '@hub/contracts';
import type { RunRow } from './schema.ts';
export const runColumns = Object.keys(runSchema.shape) as (keyof RunRow)[];

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

  async getRun(id: string, lapOffset = 0, splitOffset = 0) {
    runDetailQuerySchema.parse({ lap_offset: lapOffset, split_offset: splitOffset });
    return this.db.transaction().execute(async (tx) => {
      const run = await tx.selectFrom('runs').selectAll().where('id', '=', id).executeTakeFirst();
      if (!run) return null;
      const laps = await tx
        .selectFrom('run_laps')
        .selectAll()
        .where('run_id', '=', id)
        .orderBy('sequence')
        .limit(100)
        .offset(lapOffset)
        .execute();
      const splits = await tx
        .selectFrom('run_splits')
        .selectAll()
        .where('run_id', '=', id)
        .orderBy('sequence')
        .limit(100)
        .offset(splitOffset)
        .execute();
      const lapCount = await tx
        .selectFrom('run_laps')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('run_id', '=', id)
        .executeTakeFirstOrThrow();
      const splitCount = await tx
        .selectFrom('run_splits')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('run_id', '=', id)
        .executeTakeFirstOrThrow();
      return {
        source: DATA_SOURCE,
        run,
        laps,
        splits,
        lap_total: Number(lapCount.count),
        lap_offset: lapOffset,
        split_total: Number(splitCount.count),
        split_offset: splitOffset,
      };
    });
  }

  async getRunSamples(id: string, limit = 100, offset = 0) {
    sampleQuerySchema.parse({ limit, offset });
    return this.db.transaction().execute(async (tx) => {
      const run = await tx
        .selectFrom('runs')
        .select(['id', 'samples_synced_at'])
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
        source: DATA_SOURCE,
        synced_at: run.samples_synced_at,
        items,
        total: Number(count.count),
        limit,
        offset,
      };
    });
  }

  async saveRun(
    run: RunRow,
    laps: RunLap[] | null,
    splits: RunSplit[] | null,
    samples: RunSample[] | null,
  ) {
    const validRun = runSchema.parse(run);
    const validLaps = laps === null ? null : lapSchema.array().max(10000).parse(laps);
    const validSplits = splits === null ? null : splitSchema.array().max(10000).parse(splits);
    const validSamples =
      samples === null ? null : runSampleSchema.array().max(MAX_RUN_SAMPLES).parse(samples);
    for (const [index, sample] of (validSamples ?? []).entries()) {
      if (
        sample.run_id !== validRun.id ||
        sample.sample_index !== index ||
        (index > 0 && sample.elapsed_s < (validSamples?.[index - 1].elapsed_s ?? 0))
      ) {
        throw new Error('INVALID_SAMPLE_SEQUENCE');
      }
    }
    for (const segments of [validLaps, validSplits]) {
      let previous = -1;
      for (const segment of segments ?? []) {
        if (
          segment.run_id !== validRun.id ||
          segment.sequence <= previous ||
          (segment.start_time_s !== null &&
            segment.end_time_s !== null &&
            segment.end_time_s < segment.start_time_s)
        ) {
          throw new Error('INVALID_SEGMENT_SEQUENCE_OR_BOUNDARY');
        }
        previous = segment.sequence;
      }
    }
    if (validLaps !== null)
      for (const split of validSplits ?? []) {
        if (
          (split.first_lap_index !== null && split.first_lap_index >= validLaps.length) ||
          (split.first_lap_index !== null &&
            split.number_of_laps !== null &&
            split.first_lap_index + split.number_of_laps > validLaps.length)
        ) {
          throw new Error('INVALID_SPLIT_LAP_REFERENCE');
        }
      }
    const updates: Partial<RunRow> = { ...validRun };
    if (validSamples === null) delete updates.samples_synced_at;
    else {
      validRun.samples_synced_at = validRun.synced_at;
      updates.samples_synced_at = validRun.synced_at;
    }
    const save = async (tx: Kysely<Database>) => {
      await tx
        .insertInto('runs')
        .values(validRun)
        .onConflict((oc) => oc.column('id').doUpdateSet(updates))
        .execute();
      if (validLaps !== null) {
        await tx.deleteFrom('run_laps').where('run_id', '=', validRun.id).execute();
        for (const lap of validLaps) await tx.insertInto('run_laps').values(lap).execute();
      }
      if (validSplits !== null) {
        await tx.deleteFrom('run_splits').where('run_id', '=', validRun.id).execute();
        for (const split of validSplits) await tx.insertInto('run_splits').values(split).execute();
      }
      if (validSamples !== null) {
        await tx.deleteFrom('run_samples').where('run_id', '=', validRun.id).execute();
        for (let index = 0; index < validSamples.length; index += 50) {
          await tx
            .insertInto('run_samples')
            .values(validSamples.slice(index, index + 50))
            .execute();
        }
      }
    };
    if (this.db.isTransaction) await save(this.db);
    else await this.db.transaction().execute(save);
  }
}
