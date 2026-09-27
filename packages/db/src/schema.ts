import type { Coverage, Run, RunInterval, SyncRun, Wellness } from '@hub/contracts';

export type RunRow = Run;
export type IntervalRow = RunInterval;
export type WellnessRow = Wellness;

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
  wellness: WellnessRow;
  sync_runs: SyncRun;
  coverage: Coverage;
  sync_issues: SyncIssue;
  leases: Lease;
}
