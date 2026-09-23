import type { Coverage, HealthValue, Run, RunInterval, SyncRun } from '@hub/contracts';

export interface RunRow extends Run {
  source_json: string;
}
export interface IntervalRow extends RunInterval {
  source_json: string;
}
export interface HealthDay {
  local_date: string;
  source_json: string;
  source_hash: string;
  synced_at: string;
  snapshot_id: string;
}
export interface Snapshot {
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
