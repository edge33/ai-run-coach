import type { Coverage, Run, RunLap, RunSample, RunSplit, SyncRun, Wellness } from '@hub/contracts';

export type RunRow = Run;
export type LapRow = RunLap;
export type SplitRow = RunSplit;
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
  run_laps: LapRow;
  run_splits: SplitRow;
  run_samples: RunSample;
  wellness: WellnessRow;
  sync_runs: SyncRun;
  coverage: Coverage;
  sync_issues: SyncIssue;
  leases: Lease;
}
