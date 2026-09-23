import { type DateRange, type HealthMetric, type HealthValue, validateRange } from '@hub/contracts';
import type { Kysely } from 'kysely';
import type { Database, HealthDay } from './schema.ts';

export class HealthRepository {
  private readonly db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.db = db;
  }

  async saveHealth(day: HealthDay, values: HealthValue[]) {
    await this.db.transaction().execute(async (tx) => {
      await tx
        .insertInto('health_days')
        .values(day)
        .onConflict((oc) => oc.column('local_date').doUpdateSet(day))
        .execute();
      await tx.deleteFrom('health_values').where('local_date', '=', day.local_date).execute();
      for (const value of values) await tx.insertInto('health_values').values(value).execute();
    });
  }

  async listHealth(range: DateRange, metric: HealthMetric, limit = 50, offset = 0) {
    validateRange(range);
    const base = this.db
      .selectFrom('health_values')
      .where('local_date', '>=', range.start)
      .where('local_date', '<=', range.end)
      .where('metric', '=', metric);
    const items = await base
      .selectAll()
      .orderBy('local_date', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();
    const count = await base
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    return { items, total: Number(count.count), limit, offset };
  }
}
