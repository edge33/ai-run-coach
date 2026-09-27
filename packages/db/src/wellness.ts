import { type DateRange, validateRange, type Wellness, wellnessSchema } from '@hub/contracts';
import type { Kysely } from 'kysely';
import type { Database } from './schema.ts';

export class WellnessRepository {
  private readonly db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.db = db;
  }

  async saveWellness(row: Wellness) {
    const validRow = wellnessSchema.parse(row);
    await this.db
      .insertInto('wellness')
      .values(validRow)
      .onConflict((oc) => oc.column('date').doUpdateSet(validRow))
      .execute();
  }

  async listWellness(range: DateRange, limit = 50, offset = 0) {
    validateRange(range);
    const base = this.db
      .selectFrom('wellness')
      .where('date', '>=', range.start)
      .where('date', '<=', range.end);
    const items = await base
      .selectAll()
      .orderBy('date', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();
    const count = await base
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    return { items, total: Number(count.count), limit, offset };
  }
}
