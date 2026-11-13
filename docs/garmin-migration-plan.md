# Garmin-only implementation tracker

Direction agreed 2026-11-12: start fresh with Garmin, discard the old database and migration chain,
and use Garmin terminology. The existing Git history is not rewritten. No legacy conversion or
multi-provider integration is required.

## Decisions

- API JSON: stored run summaries and daily wellness.
- Keep automated API, MCP, core and storage tests; web app tests are excluded by user preference.
- FIT: recorded `run_laps`, workout-classified `run_splits`, and `run_samples`.
- Keep Garmin's source classifications, including names such as `intervalActive`; do not name lap
  or split collections `intervals`. Retain source split types beginning with `interval`; exclude
  overlapping run/walk/stand groups. Preserve original split sequence and lap references.
- Store source elapsed, timer and moving durations independently. Keep unknown ends null and flag
  larger duration/timestamp discrepancies; never manufacture exact boundaries.
- Do not persist planned workout steps, API aggregate split summaries, training load, CTL/ATL/form,
  corrected-stream variants or a coaching model.
- Import lifecycle and failures log at info/error; HTTP 429 logs endpoint and safe retry metadata.
  Optional debug logs show request/response summaries; no automatic retries or private payloads.
- Application imports run only after UI date selection and clicking Sync; no import CLI.
- Batch daily summaries, sleep and HRV per 31-day window. Range measurements require source dates; missing days
  remain null, and duplicate/out-of-range records fail. Ignore undated sleep rows only when duration
  is zero/null; preserve dated zero and reject undated positive sleep. Use bulk V2 heartRate.restingValue for resting_hr_bpm;
  the user explicitly accepts its minimum-HR fallback. No per-day requests to fill missing values.
- Pace request starts with GARMIN_REQUEST_INTERVAL_MS (default 1000 ms). Honor server Retry-After
  in the current API instance, expose its deadline to the UI, and reject early manual retries.
- Named upstream schemas reject breaking changes to consumed fields with `GARMIN_CONTRACT_CHANGED`.
  Preserve history and prior data on failure; ignore unused additive fields.
- SQLite only; manual read-only imports with explicit dates, max 90 inclusive days, 31-day resource
  windows, bounded requests, cancellation, leases and atomic publication without automatic retries.
- One current schema initializer, no migrations or old-schema adapter. Preserve private Garmin
  credentials and athlete context. No reset in ordinary initialization or startup.

## Checklist

- [x] Isolated API/FIT probe for the user-selected 2026-10-19–2026-10-24 range.
- [x] Verify API summaries, samples, classified splits, laps and selected-date wellness availability.
- [x] Agree Garmin lap/split terminology and explicit timing/missingness rules.
- [x] Delete the configured local legacy SQLite database and WAL/SHM without backups; verify no
      workspace services or matching Compose database volumes are running/present.
- [x] Remove old source clients/mappers, migration files and migration bootstrap.
- [x] Implement current Garmin schema initialization, contracts, repositories and source mapping.
- [x] Wire Garmin into manual atomic synchronization, local API/MCP, export, UI and Compose.
- [x] Complete application checks and synthetic initialization/Compose verification; record outcomes
      in [progress.md](progress.md).
- [x] Initialize the empty local Garmin database after checks. Initialization must not contact upstream.
- [x] Reapply Garmin work on merged cleanup `1e4fd86` and require response schemas at every JSON call.
- [x] Verify contract rejection, atomic rollback, sanitized errors and visible UI failure/reload behavior.
- [x] Batch sleep/HRV, preserve exact RHR semantics, add cancellable pacing and UI/API cooldown.
- [x] Manually import an explicitly chosen application date range through the UI. Read-only history
      inspection confirms a completed import; broader measurement verification remains ongoing.

## Remaining source limitations

Selected-date live extraction verifies the examples inspected, not all historical dates or devices.
No same-day weight entries existed in the probe; mapping is documented and tested synthetically.
Additional run types and older history need appropriate explicit-date account examples. Multi-session
original files remain unsupported rather than silently selecting a session. Runtime requests obey
bounds and fail without retries; missing source files are import failures, missing optional readings
are null. Source lap timestamps and some split elapsed-duration discrepancies remain visible quality
warnings as described in [measurement semantics](run-analysis-data.md).

## Next action

Review single-container packaging on `feature/single-image-distribution`, based on main after PR #16.
One runtime image now serves web, API and MCP through port 8080, initializes SQLite locally before
serving, and uses one host bind mount at `/app/data`. No import occurs at startup. See
[storage setup](storage.md) for directory ownership, published-image Compose and NPM configuration.
Validation and any remaining blockers are recorded in [progress](progress.md).

Continue explicit-date UI verification after deployment, respecting server cooldown. Historical
imports still require explicit dates. No deployment reset or historical import is implied by
implementation completion. The separately authorized local measurement/history reset is complete;
the initialized local database is empty.
