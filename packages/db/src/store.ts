import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Coverage, DateRange, SyncRun, Wellness } from '@hub/contracts';
import SQLite from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { LeaseRepository } from './leases.ts';
import { migrate } from './migrations.ts';
import { RunRepository } from './runs.ts';
import type { Database, IntervalRow, RunRow } from './schema.ts';
import { SyncRepository } from './sync.ts';
import { WellnessRepository } from './wellness.ts';

/** Owns the SQLite connection and delegates persistence to focused repositories. */
export class Store {
  readonly sqlite: SQLite.Database;
  readonly db: Kysely<Database>;
  private readonly runs: RunRepository;
  private readonly wellness: WellnessRepository;
  private readonly leases: LeaseRepository;
  private readonly sync: SyncRepository;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new SQLite(path);
    this.sqlite.pragma('foreign_keys = ON');
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('busy_timeout = 5000');
    this.db = new Kysely<Database>({ dialect: new SqliteDialect({ database: this.sqlite }) });
    this.runs = new RunRepository(this.db);
    this.wellness = new WellnessRepository(this.db);
    this.leases = new LeaseRepository(this.db);
    this.sync = new SyncRepository(this.db);
  }

  async migrate() {
    await migrate(this.db);
  }

  async close() {
    await this.db.destroy();
  }

  async assertReady() {
    await this.db.selectFrom('runs').select('id').limit(1).execute();
  }

  async listRuns(range?: DateRange, limit = 50, offset = 0) {
    return this.runs.listRuns(range, limit, offset);
  }

  async getRun(id: string, intervalOffset = 0) {
    return this.runs.getRun(id, intervalOffset);
  }

  async saveRun(run: RunRow, intervals: IntervalRow[] | null) {
    return this.runs.saveRun(run, intervals);
  }

  async saveWellness(row: Wellness) {
    return this.wellness.saveWellness(row);
  }

  async listWellness(range?: DateRange, limit = 50, offset = 0) {
    return this.wellness.listWellness(range, limit, offset);
  }

  async acquireLease(owner: string, now = Date.now(), ttl = 60000): Promise<boolean> {
    return this.leases.acquireLease(owner, now, ttl);
  }

  async renewLease(owner: string, now = Date.now(), ttl = 60000) {
    return this.leases.renewLease(owner, now, ttl);
  }

  async assertLease(owner: string) {
    return this.leases.assertLease(owner);
  }

  async releaseLease(owner: string) {
    return this.leases.releaseLease(owner);
  }

  async recoverInterrupted() {
    return this.sync.recoverInterrupted();
  }

  async markCoverage(row: Coverage) {
    return this.sync.markCoverage(row);
  }

  async coverage(range?: DateRange) {
    return this.sync.coverage(range);
  }

  async importedRanges(): Promise<DateRange[]> {
    return this.sync.importedRanges();
  }

  async createSync(row: SyncRun) {
    return this.sync.createSync(row);
  }

  async updateSync(id: string, patch: Partial<SyncRun>) {
    return this.sync.updateSync(id, patch);
  }

  async syncRun(id: string) {
    return this.sync.syncRun(id);
  }

  async syncHistory(limit = 50, offset = 0) {
    return this.sync.syncHistory(limit, offset);
  }

  async activeSync() {
    return this.sync.activeSync();
  }

  async issue(syncId: string, resource: string, code: string, recordRef: string | null = null) {
    return this.sync.issue(syncId, resource, code, recordRef);
  }

  async issues(syncId: string) {
    return this.sync.issues(syncId);
  }

  async counts() {
    const runs = await this.db
      .selectFrom('runs')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    const days = await this.db
      .selectFrom('wellness')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    return { run_count: Number(runs.count), health_days: Number(days.count) };
  }
}
