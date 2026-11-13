import { randomUUID } from 'node:crypto';
import type { Coverage, DateRange, SyncRun } from '@hub/contracts';
import type { Kysely } from 'kysely';
import type { Database } from './schema.ts';

export class SyncRepository {
  private readonly db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.db = db;
  }

  async recoverInterrupted() {
    const lease = await this.db
      .selectFrom('leases')
      .selectAll()
      .where('name', '=', 'writer')
      .where('expires_at', '>=', Date.now())
      .executeTakeFirst();
    await this.db
      .updateTable('sync_runs')
      .set({
        status: 'interrupted',
        error_code: 'WORKER_INTERRUPTED',
        completed_at: new Date().toISOString(),
      })
      .where('status', '=', 'running')
      .where('id', '!=', lease?.owner ?? '')
      .execute();
  }

  async markCoverage(row: Coverage) {
    await this.db
      .insertInto('coverage')
      .values(row)
      .onConflict((oc) => oc.columns(['resource', 'start', 'end']).doUpdateSet(row))
      .execute();
  }

  async coverage(range?: DateRange) {
    let query = this.db.selectFrom('coverage').selectAll();
    if (range) query = query.where('end', '>=', range.start).where('start', '<=', range.end);
    return query.orderBy('synced_at', 'desc').execute();
  }

  async createSync(row: SyncRun) {
    await this.db.insertInto('sync_runs').values(row).execute();
  }

  async updateSync(id: string, patch: Partial<SyncRun>) {
    await this.db.updateTable('sync_runs').set(patch).where('id', '=', id).execute();
  }

  async syncRun(id: string) {
    return (
      (await this.db.selectFrom('sync_runs').selectAll().where('id', '=', id).executeTakeFirst()) ??
      null
    );
  }

  async syncHistory(limit = 50, offset = 0) {
    return this.db
      .selectFrom('sync_runs')
      .selectAll()
      .orderBy('started_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();
  }

  async activeSync() {
    return (
      (await this.db
        .selectFrom('sync_runs')
        .innerJoin('leases', 'leases.owner', 'sync_runs.id')
        .selectAll('sync_runs')
        .where('sync_runs.status', '=', 'running')
        .where('leases.name', '=', 'writer')
        .where('leases.expires_at', '>=', Date.now())
        .orderBy('sync_runs.started_at', 'desc')
        .executeTakeFirst()) ?? null
    );
  }

  async issue(syncId: string, resource: string, code: string, recordRef: string | null = null) {
    await this.db
      .insertInto('sync_issues')
      .values({ id: randomUUID(), sync_id: syncId, resource, code, record_ref: recordRef })
      .execute();
  }

  async issues(syncId: string) {
    return this.db
      .selectFrom('sync_issues')
      .select(['id', 'resource', 'code', 'record_ref'])
      .where('sync_id', '=', syncId)
      .limit(100)
      .execute();
  }
}
