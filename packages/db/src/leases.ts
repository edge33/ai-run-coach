import type { Kysely } from 'kysely';
import type { Database } from './schema.ts';

export class LeaseRepository {
  private readonly db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.db = db;
  }

  async acquireLease(owner: string, now = Date.now(), ttl = 60000): Promise<boolean> {
    const result = await this.db
      .insertInto('leases')
      .values({ name: 'writer', owner, expires_at: now + ttl })
      .onConflict((oc) =>
        oc
          .column('name')
          .doUpdateSet({ owner, expires_at: now + ttl })
          .where('leases.expires_at', '<', now),
      )
      .executeTakeFirst();
    return Number(result.numInsertedOrUpdatedRows) === 1;
  }

  async renewLease(owner: string, now = Date.now(), ttl = 60000) {
    const result = await this.db
      .updateTable('leases')
      .set({ expires_at: now + ttl })
      .where('name', '=', 'writer')
      .where('owner', '=', owner)
      .where('expires_at', '>=', now)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) === 1;
  }

  async assertLease(owner: string) {
    const lease = await this.db
      .selectFrom('leases')
      .selectAll()
      .where('name', '=', 'writer')
      .where('owner', '=', owner)
      .where('expires_at', '>=', Date.now())
      .executeTakeFirst();
    if (!lease) throw new Error('LEASE_LOST');
  }

  async releaseLease(owner: string) {
    await this.db
      .deleteFrom('leases')
      .where('name', '=', 'writer')
      .where('owner', '=', owner)
      .execute();
  }
}
