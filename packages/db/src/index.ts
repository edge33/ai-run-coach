import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  Coverage,
  DateRange,
  HealthMetric,
  HealthValue,
  Run,
  RunInterval,
  SyncRun,
} from '@hub/contracts';
import { addDays, validateRange } from '@hub/contracts';
import SQLite from 'better-sqlite3';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { Migrator } from 'kysely/migration';

export interface RunRow extends Run {
  source_json: string;
}
export interface IntervalRow extends RunInterval {
  source_json: string;
}
interface HealthDay {
  local_date: string;
  source_json: string;
  source_hash: string;
  synced_at: string;
  snapshot_id: string;
}
interface Snapshot {
  id: string;
  sync_id: string;
  resource: string;
  path: string;
  hash: string;
  created_at: string;
}
interface SyncIssue {
  id: string;
  sync_id: string;
  resource: string;
  code: string;
  record_ref: string | null;
}
interface Lease {
  name: string;
  owner: string;
  expires_at: number;
}
export interface Database {
  runs: RunRow;
  run_intervals: IntervalRow;
  health_days: HealthDay;
  health_values: HealthValue;
  sync_runs: SyncRun;
  coverage: Coverage;
  snapshots: Snapshot;
  sync_issues: SyncIssue;
  leases: Lease;
}
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
const schema = `
CREATE TABLE runs (
 id TEXT PRIMARY KEY, external_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, sport TEXT NOT NULL,
 start_utc TEXT, start_local TEXT NOT NULL, local_date TEXT NOT NULL, timezone TEXT NOT NULL,
 indoor INTEGER, distance_m REAL, moving_time_s REAL, elapsed_time_s REAL, elevation_m REAL,
 avg_hr_bpm REAL, max_hr_bpm REAL, avg_cadence REAL, avg_power_w REAL, training_load REAL,
 source_hash TEXT NOT NULL, snapshot_id TEXT NOT NULL, synced_at TEXT NOT NULL,
 details_status TEXT NOT NULL, source_json TEXT NOT NULL
);
CREATE INDEX runs_date_idx ON runs(local_date, id);
CREATE TABLE run_intervals (
 run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, interval_index INTEGER NOT NULL,
 label TEXT, distance_m REAL, moving_time_s REAL, elapsed_time_s REAL, avg_hr_bpm REAL,
 avg_power_w REAL, source_json TEXT NOT NULL, PRIMARY KEY(run_id, interval_index)
);
CREATE TABLE health_days (
 local_date TEXT PRIMARY KEY, source_json TEXT NOT NULL, source_hash TEXT NOT NULL,
 synced_at TEXT NOT NULL, snapshot_id TEXT NOT NULL
);
CREATE TABLE health_values (
 local_date TEXT NOT NULL REFERENCES health_days(local_date) ON DELETE CASCADE,
 metric TEXT NOT NULL, value REAL, unit TEXT NOT NULL, definition TEXT NOT NULL,
 synced_at TEXT NOT NULL, snapshot_id TEXT NOT NULL, PRIMARY KEY(local_date, metric)
);
CREATE TABLE sync_runs (
 id TEXT PRIMARY KEY, mode TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL,
 ranges_json TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT,
 received INTEGER NOT NULL, upserted INTEGER NOT NULL, rejected INTEGER NOT NULL,
 requests INTEGER NOT NULL, completed_windows INTEGER NOT NULL, total_windows INTEGER NOT NULL,
 error_code TEXT
);
CREATE TABLE coverage (
 resource TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, synced_at TEXT NOT NULL,
 run_id TEXT NOT NULL REFERENCES sync_runs(id), PRIMARY KEY(resource, start, end)
);
CREATE TABLE snapshots (
 id TEXT PRIMARY KEY, sync_id TEXT NOT NULL REFERENCES sync_runs(id), resource TEXT NOT NULL,
 path TEXT NOT NULL, hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE sync_issues (
 id TEXT PRIMARY KEY, sync_id TEXT NOT NULL REFERENCES sync_runs(id), resource TEXT NOT NULL,
 code TEXT NOT NULL, record_ref TEXT
);
CREATE TABLE leases (name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
`;

export class Store {
  readonly sqlite: SQLite.Database;
  readonly db: Kysely<Database>;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new SQLite(path);
    this.sqlite.pragma('foreign_keys = ON');
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('busy_timeout = 5000');
    this.db = new Kysely<Database>({ dialect: new SqliteDialect({ database: this.sqlite }) });
  }
  async migrate() {
    const migrator = new Migrator({
      db: this.db,
      provider: {
        getMigrations: async () => ({
          '001_initial': {
            up: async (db: Kysely<unknown>) => {
              for (const statement of schema
                .split(';')
                .map((s) => s.trim())
                .filter(Boolean)) {
                await sql.raw(statement).execute(db);
              }
            },
          },
        }),
      },
    });
    const result = await migrator.migrateToLatest();
    if (result.error) throw result.error;
  }
  async close() {
    await this.db.destroy();
  }
  async assertReady() {
    await this.db.selectFrom('runs').select('id').limit(1).execute();
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
  async importedRanges(): Promise<DateRange[]> {
    const rows = await this.db
      .selectFrom('sync_runs')
      .select(['start', 'end'])
      .orderBy('start')
      .execute();
    return mergeRanges(rows);
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
        .selectAll()
        .where('status', '=', 'running')
        .orderBy('started_at', 'desc')
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
  async snapshot(row: Snapshot) {
    await this.db.insertInto('snapshots').values(row).execute();
  }
  async counts() {
    const runs = await this.db
      .selectFrom('runs')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    const days = await this.db
      .selectFrom('health_days')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    return { run_count: Number(runs.count), health_days: Number(days.count) };
  }
}

export function mergeRanges(ranges: DateRange[]): DateRange[] {
  const result: DateRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.start.localeCompare(b.start))) {
    const previous = result.at(-1);
    if (previous && range.start <= addDays(previous.end, 1))
      previous.end = previous.end > range.end ? previous.end : range.end;
    else result.push({ ...range });
  }
  return result;
}
