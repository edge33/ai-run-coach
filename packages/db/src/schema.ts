import type { Coverage, Run, RunInterval, RunSample, SyncRun, Wellness } from '@hub/contracts';

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
  run_samples: RunSample;
  wellness: WellnessRow;
  sync_runs: SyncRun;
  coverage: Coverage;
  sync_issues: SyncIssue;
  leases: Lease;
}
