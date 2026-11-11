# Minimal running data model: implementation tracker

Approved: 2026-09-27. Status: phases 1, 3, and 4 implemented; phase 2 source verification and remaining phase 5 coverage pending; local imports partially verified, production/reset verification pending.

Extension approved 2026-11-10: store normalized core measurement streams and exact interval
boundaries, with minimal power-source/corrected-stream identity. See [run-analysis-data.md](run-analysis-data.md).

Import policy approved 2026-11-10: abort the entire requested batch on its first error, without
automatic request retries. Publish measurements and coverage only after all windows/resources pass;
otherwise retain the previous committed snapshot plus failed/interrupted history. This supersedes
the earlier per-record/per-window partial-import policy.

Import control updated 2026-11-11: use the web UI/API with explicit dates only. Each request pulls
all approved data for those dates again. The general CLI and history-derived modes are removed;
Compose runs a dedicated migration bootstrap. Active imports require an unexpired writer lease;
the form's pending state cannot be held indefinitely by cached server status.

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
| 5. Automated validation | In progress | Codex | Explicit-date imports and summary snapshot regressions pass local gates and 51 tests; Compose config passed in prior session. Omitted all-null stream issue set aside by user. Source/log-discard checks and full current Compose/CI checks remain. |
| 6. Data reset and manual import | In progress | Unassigned | Local DB has migration 003 and samples for all 17 stored runs; all 146 intervals have boundaries. Historical reset procedure, completeness beyond stored runs, and production deployment are unverified. |

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
Negative measurements are invalid except for `form_tsb` and sample altitudes. Identifiers and timestamps use `TEXT`;
sequence and boolean storage use `INTEGER`.

| Table | Domain fields |
| --- | --- |
| `wellness` | `date` primary key; `resting_hr_bpm`, `hrv_ms`, `sleep_duration_s`, `weight_kg`, `fitness_ctl`, `fatigue_atl`, `form_tsb`, `training_load` |
| `runs` | `id` primary key containing the Intervals.icu activity ID; `start_time`, `indoor`, `distance_m`, `duration_s`, `moving_time_s`, `avg_speed_mps`, `max_speed_mps`, `avg_hr_bpm`, `max_hr_bpm`, `avg_power_w`, `elevation_gain_m`, `elevation_loss_m`, `avg_cadence_rpm`, `training_load` |
| `run_intervals` | `run_id`, `sequence`, `interval_type`, `duration_s`, `distance_m`, `avg_speed_mps`, `max_speed_mps`, `avg_hr_bpm`, `max_hr_bpm`, `avg_power_w`, `max_power_w`, `elevation_gain_m`, `avg_cadence_rpm` |
| `run_samples` | `(run_id, sample_index)` primary key; `elapsed_s`, `distance_m`, `speed_mps`, `hr_bpm`, `power_w`, `raw_power_w`, `altitude_m`, `corrected_altitude_m`, `cadence_rpm` |

The extension also adds `power_source`/`samples_synced_at` to runs and nullable interval `label`,
`start_index`, `end_index` (exclusive), `start_time_s`, `end_time_s`, and `moving_time_s`.

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
- [x] Map requested statistics and approved core streams; do not invent substitute maxima, loss, or speed.
- [x] Validate retained fields and discard all other payload fields before persistence or logging.
- [x] Upsert runs by source ID and wellness by date. Stage normalized rows in disposable SQLite,
      then publish every run/interval/sample/wellness/coverage change in one transaction. On the
      first request, validation, or write error, abort the complete batch with zero saved records.
- [x] Preserve manual sync modes, bounded windows, cancellation, and leases. Imports make no automatic
      retries and produce completed/failed/interrupted outcomes; legacy partial history remains readable.
      Valid empty responses clear prior children only when the whole batch succeeds.

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

| 2026-11-10 | Codex / run analysis extension | Add migration 003, normalized sample import, interval boundaries, local API/MCP pagination, and normalized export; run check, typecheck, lint, tests, build, diff checks | All gates pass, including 34 tests outside sandbox. Initial socket/stdio sandbox failures and a corrected test-only type error are detailed in progress.md. No athlete DB migration/write or live sync. | Review/deploy; migrate before updated services; manually re-sync explicit date ranges. Legacy stale coverage remains separate. |
| 2026-11-10 | Codex / status verification | Read local migration names, aggregate sample coverage, and latest sync status with SQLite readonly | Migration 003 applied locally; 9 of 17 runs have samples; latest sync completed with no rejected records. Intervening import was not performed by this agent. Documentation diff check passes; no application tests repeated. | Review/commit/release; backfill remaining dates; finish source/log-discard/stale-coverage work, then wiki/agent workflow. No reset needed for stream backfill. |
| 2026-11-10 | Codex / atomic import policy | Replace partial imports with normalized SQLite staging and one publication transaction; disable import retries; run check/typecheck/lint/tests/build/diff checks | All gates pass, including 47 tests outside sandbox. First error aborts all windows/resources; failures/cancellation preserve old data and coverage. No new migration or live import. | Review/commit/deploy updated services; finish field/log verification and power quality investigation; validate Compose/CI. |
| 2026-11-10 | Codex / post-import review | In-memory synthetic probes for summary interleaving, expired writer leases, and sparse `all` history | Reproduced three bugs: old measurement rows with new coverage; expired running row still disables UI; `all` collapses historical gaps through bounding ranges. No runtime edits or athlete-data access. Documentation diff check passes; application gates not repeated. | Fix all three with regression tests before release. |
| 2026-11-11 | Codex / web import control | Remove CLI imports; require a live lease for active status; derive form busy state from its mutation; run check/typecheck/lint/tests/build/diff checks | All gates pass, including 51 synthetic tests. Expired import recovery and cached-status retry work from the web; maintenance migrate/export still work. No athlete DB access or live import. | Fix remaining summary snapshot and sparse-history issues; review/commit/deploy. |

| 2026-11-11 | Codex / independent sub-agent review | Review tracked/untracked changes; core tests (25 passed), DB tests (6 passed), synthetic probes, public OpenAPI schema read, diff check | Three P2 findings: missing optional all-null stream data aborts imports; known summary snapshot and sparse-history bugs persist. No implementation edits or athlete-data access. | Fix all three with regression tests before release; full gates/browser/Compose were not repeated. |

| 2026-11-11 | Codex / explicit-date imports | Remove history-derived modes/general CLI; add full-reimport and deployment-bootstrap tests; check/typecheck/lint/test/build/diff and synthetic Compose config | All pass, including 49 tests. Summary fix proposed only; user set aside omitted all-null stream finding. No athlete data access or live import. | Review changes; summary implementation requires a later request; full Compose/CI checks remain. |

| 2026-11-11 | Codex / summary snapshot fix | One transaction for measurement/coverage reads; two separate-connection publication regressions; check/typecheck/lint/test/build/diff | All pass, including 51 synthetic tests. Both new regressions fail against old code. No athlete data access, schema migration, live import, or deployment. | Review/commit accumulated work; complete remaining source/Compose/CI verification. |

| 2026-11-11 | Codex / independent verification review | Sub-agent review of tracked/untracked changes; core/DB/web/API/MCP tests; synthetic Compose config; diff check | All 51 tests pass. Summary/expired-active fixes verified; history-derived import path removed. No new confirmed implementation defect. Corrected stale operational CLI docs; all-null parser issue excluded by user. | Review/commit accumulated work and finish source/Compose/CI checks before deployment. |

| 2026-11-11 | Codex / PR publication | Commit reviewed changes as 74fa65e; push money-hedgehog; create PR #12 against main | Push and PR creation succeeded. Prior full gates and 51-test review validation stand; no merge/deployment/live import. | Review PR #12 and CI; complete outstanding source/Compose/browser verification before deployment. |

For each implementation session, append commands and outcomes, including failures and checks not run.
Do not mark a phase complete based only on code changes when its validation is still pending.

## Current handoff

- Published [PR #12](https://github.com/edge33/ai-run-coach/pull/12) from `money-hedgehog` to `main`;
  implementation commit `74fa65e`. Next action: review PR/CI and complete source/Compose/browser
  verification before deployment. No merge or live import performed.


- Independent follow-up review confirms summary consistency and expired-active recovery fixes,
  plus removal of history-derived import paths. All 51 tests independently pass; no new confirmed
  implementation finding. Current operational docs corrected; user-set-aside stream issue remains
  excluded. Review/commit accumulated work, then complete source/Compose/CI checks before release.


- Explicit-date imports only: history-derived modes and the general CLI are removed. Every import
  fetches the full approved dataset for the selected dates again. Compose uses a dedicated migration
  bootstrap; normalized export remains in the core library. Local gates and 49 synthetic tests pass,
  as does Compose config with a synthetic environment. No live athlete import/migration was run.
- Summary consistency is now fixed: run/health measurement and coverage reads share one SQLite
  transaction. Two concurrent-publication regressions fail on old code and pass after the fix;
  full gates pass with 51 tests. No schema or response contract change and no athlete data access.
  User-set-aside omitted all-null stream behavior remains unchanged. Next action: review/commit
  accumulated work and complete outstanding source/Compose/CI checks before deployment.

- Current follow-up: all-or-nothing import policy. Network downloads stage normalized rows in a
  disposable SQLite database; final publication is a single transaction covering all windows and
  resources. The first error stops the import, leaves old measurements/coverage unchanged, and
  records failure with zero upserts. No automatic import retries; cancellation/lease loss discards
  staging. Import history is operational metadata and does not select future import dates.
  No schema migration is needed for this policy change. See progress.md for checks.
  The former partial-import coverage finding is superseded by this snapshot policy; older data is
  not made fresh by a failed attempt, so consumers must still inspect latest sync status/timestamps.

- Current implementation: run-analysis sample extension on `money-hedgehog` starting at `50338e6`.
  Migration 003 preserves existing data and adds STRICT sample storage, exact interval timing, and
  minimal power provenance. Manual sync now publishes the entire batch atomically; failed
  stream retrieval/validation discards all staged changes. Bounded local API/MCP reads and normalized
  export include samples. Later read-only verification confirms migration 003 and sample imports for
  all 17 local runs (41,323 samples); all 146 intervals have exact boundaries. Production state and
  historical completeness beyond stored runs are unverified. Migrations remain required before
  updating other deployments; no further stream backfill is needed for currently stored runs.
  Validation and remaining unrelated blockers are recorded in the current progress entry.

- Earlier 2026-11-10 power investigation on `money-hedgehog` (`50338e6`): public OpenAPI and
  code tracing confirm supported run/interval power mappings. Synthetic core tests (9) and focused
  HTTP tests (2) pass, including import-to-response power preservation. No runtime mapping change
  was warranted. That investigation initially lacked credentials; later worktree configuration
  enabled the requested read-only HR export. The local DB now contains separate raw/selected power
  streams, exposing a selected-stream quality issue. Source quality still needs consideration in
  coaching interpretation; no upstream settings changes were made by this agent.

- Earlier work item: PR #10 API simplification on `refactor/simplify-api-sync` in
  `/tmp/ai-run-coach-worktrees/simplify-api-sync`. The latest user instruction supersedes the
  background-task approach: the UI icon starts a request-bound import and waits for its final
  `200` result. Removed the manager and SSE flow; storage schema is unchanged. All local gates
  pass, including 22 tests outside the sandbox; container checks were not rerun. Review the
  updated PR and CI. See `docs/progress.md` for commands, request-timeout limits, and handoff.
- Next minimal-model correctness action: confirm current upstream keys/units with live official documentation or a
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

### 2026-11-09: publish accumulated UI/schema changes

- User authorized publication. Implementation commit `5656c16` was pushed on `clumsy-mole` and
  [PR #11](https://github.com/edge33/ai-run-coach/pull/11) opened against `main`. Local gates
  pass, including 29 tests; subsequent publication handoff changes only documentation.
- Next action: review PR and CI, then apply migrations before updated service startup at deployment.
  No merge, production deployment, athlete database migration/reset, or live sync was performed.
