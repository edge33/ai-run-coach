# Minimal running data model: implementation tracker

Approved: 2026-09-27. Status: phases 1, 3, and 4 implemented; phase 2 source verification and phase 5 final CI pending; deployment reset pending.

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
| 5. Automated validation | In progress | Codex | Local gates and Compose pass; await PR CI after push. |
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
| `runs` | `id` primary key containing the Intervals.icu activity ID; `start_time`, `indoor`, `distance_m`, `duration_s`, `moving_time_s`, `avg_speed_mps`, `max_speed_mps`, `avg_hr_bpm`, `max_hr_bpm`, `avg_power_w`, `max_power_w`, `elevation_gain_m`, `elevation_loss_m`, `avg_cadence_rpm`, `training_load` |
| `run_intervals` | `run_id`, `sequence`, `interval_type`, `duration_s`, `distance_m`, `avg_speed_mps`, `max_speed_mps`, `avg_hr_bpm`, `max_hr_bpm`, `avg_power_w`, `max_power_w`, `elevation_gain_m`, `elevation_loss_m`, `avg_cadence_rpm` |

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
The reviewed model does not establish activity maximum power or elevation loss keys; both remain
null. Current public OpenAPI access and a live credential-backed payload remain unverified.

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
      power and elevation loss. Public OpenAPI access failed during planning; record verification
      evidence here. Unsupported or absent fields remain null.
- [x] Accept only `Run`, `TrailRun`, and `VirtualRun`; implement the wellness mapping above.
- [x] Import ordered `icu_intervals`, including work and recovery, with nullable upstream type text.
- [x] Map only requested statistics; do not fetch streams or invent substitute maxima, loss, or speed.
- [x] Validate retained fields and discard all other payload fields before persistence or logging.
- [x] Upsert runs by source ID and wellness by date. Replace intervals transactionally only after a
      valid detail response; failed detail requests preserve prior intervals and mark detail status.
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

For each implementation session, append commands and outcomes, including failures and checks not run.
Do not mark a phase complete based only on code changes when its validation is still pending.

## Current handoff

- Next action: push changes to draft PR #5 and review CI. Confirm current upstream keys/units with live official documentation or a credential-backed import before marking phase 2 complete.
- Known verification gap: current upstream activity maximum-power and elevation-loss keys were not confirmed; both remain null.
- Deployment input still needed: explicit historical import range, unless supplied by later context.
- Code changed on `feature/minimal-data-model`; no athlete data, reset, import, or merge was performed. The branch was pushed for draft PR #5.
