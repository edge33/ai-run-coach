# Minimal running data model: implementation tracker

Approved: 2026-09-27. Status: phases 1, 3, and 4 implemented; phase 2 source verification and remaining phase 5 coverage pending; deployment reset pending.

This plan supersedes conflicting data-model, snapshot, backup/restore, and migration requirements
in [implementation-plan.md](implementation-plan.md). Unrelated architecture and repository rules
remain in force. See [progress.md](progress.md) for repository state and validation history.

## Agent handoff protocol

- Work through phases in order; keep implementation and deployment completion separate.
- Mark a checkbox complete only when its acceptance condition is met.
- Update the phase table and append commands/results to the execution log during each work session.
- Record blockers and the next concrete action here and in `docs/progress.md` before handing off.
- Preserve user worktree changes. Do not push or merge without explicit instruction.
- Do not record credentials, athlete measurements, or raw upstream payloads in this document.

| Phase | Status | Owner | Evidence / blocker |
| --- | --- | --- | --- |
| 1. Contracts and database | Complete | Codex | STRICT domain tables, runtime schemas, date-boundary and FK tests pass. |
| 2. Import and synchronization | In progress | Codex | Synthetic sync tests pass; current upstream OpenAPI field verification remains incomplete. |
| 3. API, MCP, and web | Complete | Codex | Consumers and protocol tests use the new records. |
| 4. Storage and operational cleanup | Complete | Codex | Snapshot/backup code removed; normalized export and disposable Compose lifecycle pass. |
| 5. Automated validation | In progress | Codex | Local gates, Compose, and both PR CI jobs pass; remaining mapping/log-discard coverage is tracked below. |
| 6. Data reset and manual import | Pending | Unassigned | — |

Statuses: Pending, In progress, Blocked, Complete.

## Approved decisions

- SQLite with existing Kysely and `better-sqlite3`; no migration-library research or replacement.
- Start with a fresh database. Do not migrate old records or create backups.
- Delete this application's old database, SQLite sidecars, raw snapshots, and existing data backups
  during the reset phase. Preserve credentials, configuration, and the athlete wiki.
- Stop retaining source JSON, source hashes, and snapshots. Remove backup/restore functionality.
- Keep normalized export, minimal synchronization metadata, coverage, issue codes, and writer leases.
- Import road, trail, treadmill, and virtual runs only. Synchronization remains manual and read-only
  against Intervals.icu; API/MCP reads and service startup never synchronize.
- Keep training plans, periods, and coaching interpretation outside server-side domain models.

## Target schema and semantics

Measurements use nullable SQLite `REAL`: missing remains null and measured zero remains zero.
Negative measurements are invalid except for `form_tsb`. Identifiers and timestamps use `TEXT`;
sequence and boolean storage use `INTEGER`.

| Table | Domain fields |
| --- | --- |
| `wellness` | `date` primary key; `resting_hr_bpm`, `hrv_ms`, `sleep_duration_s`, `weight_kg`, `fitness_ctl`, `fatigue_atl`, `form_tsb`, `training_load` |
| `runs` | `id` primary key containing the Intervals.icu activity ID; `start_time`, `indoor`, `distance_m`, `duration_s`, `moving_time_s`, `avg_speed_mps`, `max_speed_mps`, `avg_hr_bpm`, `max_hr_bpm`, `avg_power_w`, `elevation_gain_m`, `elevation_loss_m`, `avg_cadence_rpm`, `training_load` |
| `run_intervals` | `run_id`, `sequence`, `interval_type`, `duration_s`, `distance_m`, `avg_speed_mps`, `max_speed_mps`, `avg_hr_bpm`, `max_hr_bpm`, `avg_power_w`, `max_power_w`, `elevation_gain_m`, `avg_cadence_rpm` |

- Interval primary key is `(run_id, sequence)`, with a cascading foreign key to `runs`.
  Sequence follows upstream array order, starting at zero.
- `start_time` preserves the source local timestamp; index `(start_time, id)` for date queries.
  Do not invent UTC offsets.
- `duration_s` means elapsed seconds on runs and intervals. Runs additionally retain moving time.
- `indoor` is nullable and maps from the upstream trainer flag. Virtual does not imply treadmill.
- Cadence retains upstream RPM units; presentation may convert to steps/minute explicitly.
- Add `synced_at` to runs and wellness, and `details_status` to runs. Intervals inherit parent
  provenance. Retain sync history, coverage, issues, and leases as operational tables.
- Domain tables use SQLite `STRICT` typing. Repository writes validate with shared Zod schemas.

### Wellness mapping

| Destination | Source / definition |
| --- | --- |
| `date` | `id` |
| `resting_hr_bpm` | `restingHR` |
| `hrv_ms` | `hrv`, never substitute SDNN |
| `sleep_duration_s` | `sleepSecs` |
| `weight_kg` | `weight` |
| `fitness_ctl` | `ctl` |
| `fatigue_atl` | `atl` |
| `form_tsb` | Same-day `ctl - atl`; null if either is absent |
| `training_load` | `ctlLoad`; no fallback to `atlLoad` |

Daily wellness load values preserve upstream scope and may include other sports. Form is the
defined absolute difference, not a promise to reproduce every Intervals.icu display setting.

### Upstream field evidence

Intervals.icu's [developer-published activity and interval model](https://forum.intervals.icu/t/server-side-data-model-for-scripts/25781/16)
lists local time, distance, elapsed/moving seconds, speeds, HR, cadence, training load, and
interval `max_watts`. The [developer's interval API example](https://forum.intervals.icu/t/api-access-to-intervals-icu/609/14)
confirms `icu_intervals`, work/recovery type, elapsed time, speed, HR, power, and elevation gain.
The [developer-published wellness model](https://forum.intervals.icu/t/server-side-data-model-for-scripts/25781/16)
lists `restingHR`, `hrv`, `sleepSecs`, `weight`, `ctl`, `atl`, and `ctlLoad`.
On 2026-11-09, the [current public OpenAPI schema](https://intervals.icu/api/v1/docs) was accessible.
`Activity` includes `icu_average_watts` (integer watts) and `total_elevation_loss` (numeric meters),
but no activity maximum-power field. `Interval` includes `average_watts`/`max_watts`, but no elevation
loss field. The importer now maps activity `total_elevation_loss` to `elevation_loss_m`; activity
maximum power and interval elevation loss are excluded from the persisted schema and contracts.
Migration `002_remove_unsupported_measurements` removes these columns from existing databases,
while leaving `001_initial` immutable. Read-only credential-backed field-presence
checks confirmed numeric activity elevation loss and null average power in sampled responses, despite
watts-stream availability. No stream data was fetched or substitute statistics calculated.
Verification of every other retained field remains pending.

## Implementation checklist

### 1. Contracts and database

- [x] Replace the old schema with a clean initial Kysely migration; no legacy-record conversion.
      Keep future migrations immutable and ordered, with one module per migration.
- [x] Implement the three domain tables, indexes, foreign key, and operational metadata above.
- [x] Replace generic health-day/health-value storage and repository methods with wellness rows.
- [x] Update shared schemas/types and metric enums; remove unsupported fields and snapshot references.
- [x] Verify fresh migration success, repeated migration no-op behavior, and foreign-key enforcement.

### 2. Import and synchronization

- [ ] Verify current upstream keys and units for every retained measurement, especially run maximum
      fields against current public OpenAPI and record verification evidence here. Run maximum
      power and interval elevation loss are now excluded; absent supported measurements remain null.
- [x] Accept only `Run`, `TrailRun`, and `VirtualRun`; implement the wellness mapping above.
- [x] Import ordered `icu_intervals`, including work and recovery, with nullable upstream type text.
- [x] Map only requested statistics; do not fetch streams or invent substitute maxima, loss, or speed.
- [x] Validate retained fields and discard all other payload fields before persistence or logging.
- [x] Upsert runs by source ID and wellness by date. Replace intervals transactionally only after a
      valid detail response. On a failed detail request, record an issue and skip the activity,
      preserving any prior run and intervals; the window remains partial.
- [x] Preserve manual sync modes, bounded windows, retries, leases, coverage, and partial-failure
      behavior. A valid empty interval response clears old intervals; an unavailable response does not.

### 3. API, MCP, and web

- [x] Update consumers together: repositories, summaries, API, MCP, and web views.
- [x] Keep existing endpoint paths and MCP tool names; revise response schemas and documentation.
      Health retrieval returns dated wellness rows; summaries retain supported metric selection.
- [x] Use date/time labels instead of removed run names. Show indoor state only when known.
- [x] Preserve units, missingness, freshness, coverage, bounded pagination, and no-sync-on-read behavior.

### 4. Storage and operational cleanup

- [x] Remove snapshot and backup/restore modules, commands, configuration, mounts, and related tests.
- [x] Keep export, emitting only the new normalized data without snapshot/backup dependencies.
- [x] Update Docker/Compose, example configuration, scripts, and operational documentation.
- [x] Update `docs/implementation-plan.md` to describe the implemented architecture and
      `docs/progress.md` with exact state and validation evidence.
- [x] Keep private data excluded from Git and Docker image layers, including legacy archive locations.

### 5. Automated validation

- [x] Test all retained mappings, nulls, zero, negative form, elapsed versus moving time, and local dates.
- [x] Test road, trail, treadmill, virtual runs, and exclusion of non-running activities.
- [x] Test repeated syncs, upstream edits, interval replacement, empty intervals, and detail failures.
- [x] Test revised API/MCP contracts, removed metrics, and local reads making no upstream requests.
- [ ] Verify discarded payload fields cannot reach SQLite, exports, logs, or snapshot files.
- [x] Run `npm run check`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.
- [x] Run Compose migration, startup, health, and persistence checks with synthetic data; adapt lifecycle
      checks to remove backup/restore expectations. Browser E2E remains deferred.

### 6. Data reset and manual import

The user explicitly chose deletion without backups. This is a one-time reset, not behavior to add to
ordinary startup or migration commands. Do not run broad volume or directory deletion that includes
the wiki or unrelated applications.

- [ ] Resolve this application's actual database, WAL/SHM, snapshot, and backup locations, including
      any relevant Compose volumes; record the bounded cleanup scope without exposing private data.
- [ ] Stop all application writers, including API, MCP, and sync workers.
- [ ] Delete only the old database and associated sidecars, snapshots, and data backups. Create no
      backup. Preserve credentials, configuration, and athlete wiki content.
- [ ] Initialize the fresh schema and start all consumers against it; verify no automatic upstream sync.
- [ ] Manually import an explicit historical date range. If the intended range or credentials are not
      available, record this phase as pending/blocked rather than claiming completion. On a fresh
      database, `all` cannot discover the user's historical date range.
- [ ] Record reset/import outcomes, final validation, and any deployment limitations in both trackers.

## Execution log

| Date | Agent / phase | Action or command | Result / evidence | Next action |
| --- | --- | --- | --- | --- |
| 2026-09-27 | Documentation | Persist approved plan and tracking checklist | Plan only; no implementation, deletion, or import performed | Start phase 1 after inspecting the current worktree |
| 2026-09-27 | Codex / phase 1 | `git fetch origin main`; `git switch -c feature/minimal-data-model origin/main` | Fetched `9b3aeb5` and branched from it; preserved existing uncommitted plan edits | Replace contracts and database |
| 2026-09-27 | Codex / phase 1 | `npm run check:fix`; `npm run test -w @hub/db`; `npm run typecheck -w @hub/db`; `npm run check`; `git diff --check` | All pass; 3 database tests cover repeat migration, FK and measurement constraints, upsert, leases, rollback | Update import and consumers |
| 2026-09-27 | Codex / phase 1 | `npm run typecheck` | Fails in `@hub/core` because phase 2–4 mapping, summaries, sync, backup, and tests still refer to removed schema and methods. No full test/build run yet. | Implement phase 2, then update consumers |
| 2026-09-27 | Codex / PR | `gh pr create --draft --base main --head feature/minimal-data-model`; `gh pr checks 5 --watch` | Draft PR #5 opened. Both application jobs failed at `npm run typecheck` with the same old-schema references seen locally. | Keep PR draft while completing phases 2–4 |
| 2026-09-27 | Codex / review | `npm run test -w @hub/db`; `npm run typecheck -w @hub/db`; isolated Node/SQLite probes | Database tests and typecheck pass. SQLite accepts null `wellness.date`/`runs.id`, text `weight_kg`, and noninteger interval sequences. A date query ending 9999-12-31 misses that day's run. An old database skips the new migration, but legacy databases are outside the approved fresh-start path. | Fix fresh-schema constraints; test boundary date |
| 2026-09-27 | Codex / phases 1–4 | Add STRICT tables, runtime validation, date-boundary fix, normalized mappings, API/MCP/web consumers, export, and remove snapshot/backup code | Fresh database tests pass; source-activity IDs and wellness rows work through API/MCP; synthetic detail failure retains intervals and valid empty detail clears them | Run all gates and Compose |
| 2026-09-27 | Codex / phase 5 | `npm run check`; `npm run typecheck`; `npm run lint`; `npm test`; `npm run build` | All pass locally. First sandbox test attempt closed MCP stdio subprocess; full suite passed outside sandbox. | Verify Compose and PR CI |
| 2026-09-27 | Codex / phase 5 | `docker compose -p running-data-hub-validation config --quiet`; `up --build -d --wait`; `nginx -t`; `node scripts/compose-smoke.mjs`; `node scripts/compose-lifecycle.mjs`; `down -v` | All pass on disposable synthetic stack; its volumes removed. No athlete data or live credentials used. | Push to draft PR and review CI |
| 2026-09-27 | Codex / CI | `git push`; `gh pr checks 5 --watch` | Both application jobs passed, including check, typecheck, lint, tests, build, Compose startup, smoke, lifecycle, and teardown. | Retain draft status pending source verification and deployment reset |
| 2026-09-27 | Codex / review follow-up | Change detail-failure handling to skip activity writes; add 404 regression for existing and new runs | The prior run remains unchanged, the new run is absent, issues are recorded, and the window is partial. The date-shift review finding was withdrawn after user clarification. Validation results are in `docs/progress.md`. | Finish source-key and mapping/log-discard verification, then plan reset/import |
| 2026-09-27 | Codex / second adversarial review | In-memory probe: successful empty 2026-09-20 run sync, then newly listed run with 404 detail | New run is skipped and the second sync is `partial`, but the old coverage row makes `summarizeRuns` return zero distance with no warning. No persistent data changed. | Make summary coverage reflect the newer incomplete attempt and add regression coverage |

| 2026-11-09 | Codex / PR #6 rebase | Rebase four follow-up commits onto `origin/main` (`95040c1`); `pnpm install --frozen-lockfile`; `pnpm run check`; `pnpm run typecheck`; `pnpm run lint`; `pnpm test`; `pnpm run build`; `git diff --check` | All gates pass on Node 26.13.0/pnpm 12.18.0, including all 17 tests. Retained migration and handoff notes; Compose not rerun. | Push explicitly approved by user; verify PR #6 head/CI, then address stale coverage; other tasks remain pending |

| 2026-11-09 | Codex / API simplification | Replace API child worker with cancellable in-process sync; run check, typecheck, lint, tests, build, and Compose config | All gates pass; 20 tests pass outside sandbox; container checks not rerun. Schema unchanged. | Review API simplification; stale coverage and deployment steps remain pending |

| 2026-11-09 | Codex / request-bound sync | Remove background manager and SSE; await imports from UI click; run check, typecheck, lint, tests, and build | All pass, including 22 tests outside sandbox; HTTP disconnect cancels import. Schema unchanged. | Review updated PR #10 and CI; stale coverage remains separate |

For each implementation session, append commands and outcomes, including failures and checks not run.
Do not mark a phase complete based only on code changes when its validation is still pending.

## Current handoff

- Current work item: PR #10 API simplification on `refactor/simplify-api-sync` in
  `/tmp/ai-run-coach-worktrees/simplify-api-sync`. The latest user instruction supersedes the
  background-task approach: the UI icon starts a request-bound import and waits for its final
  `200` result. Removed the manager and SSE flow; storage schema is unchanged. All local gates
  pass, including 22 tests outside the sandbox; container checks were not rerun. Review the
  updated PR and CI. See `docs/progress.md` for commands, request-timeout limits, and handoff.
- Next minimal-model correctness action (deferred during API simplification): address the second
  adversarial review finding on stale coverage after a partial
  detail import. Then confirm current upstream keys/units with live official documentation or a
  credential-backed import before marking phase 2 complete, finish remaining mapping/log-discard
  test coverage, and separately plan the data reset and historical import.
- Field verification follow-up: public OpenAPI now confirms activity elevation loss; its mapping is
  implemented below. Activity maximum power has no corresponding field in the reviewed schema and
  has been removed from the current schema. Verification of all retained measurements is still incomplete.
- Deployment input still needed: explicit historical import range, unless supplied by later context.
- Earlier minimal-model work is included in main through PR #6 at `a0a8f61`. This API
  simplification is being updated in PR #10 following the request-bound sync instruction. No athlete data,
  reset, or import was performed.

### 2026-11-09: single-page UI simplification

- User superseded the multi-view web design with one plain page: a recent-sync button and paginated
  run/health lists. The last 30 local dates are displayed; recent sync imports 30 dates. Removed
  navigation, overview, detail screens, charts, summaries, and sync-history/options UI.
- Phase 3 remains implemented; API/MCP, schema, and importer behavior are unchanged. Range/historical
  import remains available through the CLI. Focused web tests pass; see progress.md for full gates.
- Full gates pass on Node 26.13.0 / pnpm 12.18.0: check, typecheck, lint, 24 tests, build,
  and diff whitespace validation. The full suite required a rerun outside the sandbox for local
  sockets/subprocesses. Docker/Compose and browser checks were not rerun.
- Next action: review this UI change. Existing source-verification,
  discarded-field coverage, stale-summary-coverage, and separate deployment/import follow-ups remain.

### 2026-11-09: latest 30-day sync

- Recent sync and the empty-history fallback now request 30 inclusive local dates instead of 14,
  matching the single-page list window. Explicit ranges and reconciliation of existing imported
  ranges are unchanged. Added synthetic run/health request-boundary coverage across month/DST changes.
- Validation passed: `pnpm run check`, `pnpm run typecheck`, focused core/web suites (14 tests),
  `pnpm run build`, and `git diff --check`. No full-suite/browser/Compose rerun for this follow-up.
- Next action: review this follow-up with the single-page UI. Existing deferred work above remains
  separate; no live import, deployment reset, or athlete-data access was performed.

### 2026-11-09: date pickers and bounded selections

- Latest user instruction supersedes the 30-day default: use start/end pickers defaulting to 15
  inclusive local dates. Date selection controls plain local lists and explicit range sync. Maximum
  three months is defined/displayed as 90 inclusive dates and enforced in the UI and core/API.
- Recent and empty-history defaults also use 15 dates. Explicit range sync rejects oversized,
  reversed, and future ranges before taking the lease or contacting upstream. Existing-history
  reconciliation stays windowed; longer historical imports require multiple explicit ranges.
- Added UI/API/core boundary coverage and strengthened overlapping-sync regression to check run
  and wellness updates without duplicates. All gates pass: check, typecheck, lint, 27 tests, build,
  and diff whitespace validation. Full tests ran outside the sandbox for sockets/subprocesses;
  browser/Compose checks were not run.
- Next action: review accumulated changes. Deferred upstream verification,
  discarded-field coverage, stale-summary coverage, and deployment/reset/import remain separate.

### 2026-11-09: missing power and elevation-loss investigation

- Confirmed run maximum power and elevation loss were hardcoded null. Average power correctly
  maps `icu_average_watts`; sampled upstream responses return null despite watts-stream availability.
- Public OpenAPI now verifies activity `total_elevation_loss`; mapped it without changing storage.
  Activity maximum power and interval elevation loss have no corresponding fields in the reviewed
  schemas, so remain null. No streams, inferred statistics, or substitute maxima were introduced.
- Read-only diagnostics used configured SQLite and upstream GETs, printing only aggregate counts,
  field-presence/type metadata, and power availability flags. No raw payloads or measurements were
  retained. No sync or data writes occurred. Previous synthetic-only statements describe earlier work.
- Added synthetic positive/zero/missing/invalid elevation-loss and average-power mapping checks,
  plus persistence assertions. `pnpm run check`, `pnpm run typecheck`, focused core tests (9), and
  `git diff --check` pass. No full-suite/build/browser/Compose rerun for this mapping-only follow-up.
- Next action: review the mapping; after deployment, user-triggered sync can populate elevation loss.
  Investigate upstream running power configuration/processing for null average power; no settings
  were changed and no athlete records were written. All changes remain uncommitted on `clumsy-mole`
  at HEAD `baba1812`, alongside the earlier UI/date changes.

### 2026-11-09: browse all stored records independently of sync dates

- Latest UI instruction supersedes selection-controlled lists: start/end dates affect sync only.
  Runs and wellness always browse all stored records, newest first, on separate 50-entry pages.
  Changing valid/invalid sync dates preserves visible lists and page offsets.
- HTTP lists accept optional paired dates and cap pages at 50; omitted dates read all records.
  Store repositories support optional ranges. MCP date-bounded contracts remain unchanged.
- Synthetic API/UI regressions cover older records, independent pagination, the 50-entry cap,
  unchanged lists after date edits, and no sync on reads. All gates pass: check, typecheck, lint,
  28 tests, build, and diff whitespace validation. Browser/Compose checks were not run.
- Next action: review accumulated uncommitted changes on `clumsy-mole` at HEAD `baba1812`.
  No blockers or live sync/data access for this follow-up.

### 2026-11-09: interval power/elevation follow-up

- Read-only checks of stored intervals and three upstream activity details confirm sampled interval
  `average_watts`/`max_watts` are null and `total_elevation_loss` is absent. Existing interval
  average/max power mappings are correct. Interval loss remains null because no upstream value
  is supplied; unlike activity loss there is no confirmed interval loss key to add.
- Added synthetic mapping/persistence assertions for interval power values, zeros, null/missing
  fields, and negative-value validation. No production code or athlete records changed. Only
  aggregate/type/presence diagnostic metadata was printed; raw payloads were not retained.
- `pnpm run check`, focused core tests (9), core typecheck, and `git diff --check` pass.
  Full-suite/build/browser/Compose checks were not repeated for this test/documentation follow-up.
- Next action: review regressions, then upstream power processing follow-up if desired. Changes
  remain uncommitted on `clumsy-mole` at `baba1812`. No stream derivation, source changes,
  live sync, push, merge, or deployment.

### 2026-11-09: remove unsupported measurements and migrate

- User approved removing `runs.max_power_w` and `run_intervals.elevation_loss_m`. Contracts,
  source mapping, repository projections, and fixtures now omit them. Run elevation loss and
  interval average/max power remain supported. API/MCP responses and normalized export follow
  the revised contracts/schema.
- Added immutable migration `002_remove_unsupported_measurements` using SQLite DROP COLUMN;
  left `001_initial` unchanged. Fresh installs apply both; existing installations apply only 002.
  No reset or upstream re-sync is needed to drop these unsupported columns. Apply migrations before
  starting updated services. This is distinct from the separately pending historical deployment reset.
- Synthetic tests cover fresh/repeated migrations, upgrade from a populated 001 database, retained
  records/measurements/leases, indexes, STRICT tables, FK checks/cascades, and export field removal.
- Database tests pass (5). An initial export assertion used the wrong array key; corrected to the
  existing `intervals` export key. All gates now pass: check (68 files), typecheck, lint, 29 tests,
  build, and diff whitespace validation. Full tests ran outside the sandbox; browser/Compose checks
  were not run. No athlete database was migrated.
- User authorized publishing accumulated changes as a PR. Next action: publish/review PR and CI;
  deploy code with `pnpm run migrate` before service startup. No merge is authorized.
