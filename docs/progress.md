# Running Data Hub progress

Last updated: 2026-11-11

## Published PR #12 (current)

- User authorized pushing and opening a PR. Committed the reviewed accumulated implementation,
  tests, and docs as `74fa65e` on `money-hedgehog`, pushed to origin, and opened
  [PR #12](https://github.com/edge33/ai-run-coach/pull/12) against `main`.
- The implementation commit contains only reviewed source/tests/docs/configuration; no athlete
  data, credentials, databases, raw snapshots, or local personal configuration. Local validation
  remains the previously recorded passing full gates, 51 synthetic tests, independent review, and
  synthetic Compose config; publishing does not constitute deployment or historical import.
- Next action: review PR #12 and hosted CI, then complete outstanding source/Compose/browser
  verification before deployment. No merge, deployment, or live import was performed. This docs
  publication record is committed separately after PR creation.

## Independent verification review (current)

- User requested another sub-agent code review and verification of earlier findings. Reviewer
  inspected tracked/untracked accumulated changes on `money-hedgehog`, HEAD `50338e6`; no new
  confirmed implementation defect found. Summary run/health reads use the same transaction and
  separate-connection regressions verify concurrent publication. Expired active status/retry recovery
  is fixed. History-derived modes are rejected at HTTP/core boundaries; their date-selection helper
  and general CLI are gone, so the sparse-history import path is removed. Old stored mode labels
  and historical log entries do not enable imports. The user-set-aside all-null parser issue remains
  unchanged and excluded, not claimed fixed.
- Reviewer independently ran core (26), DB (6), web (8), API/bootstrap (8), and MCP (3) tests:
  all 51 pass. API's initial in-sandbox run passed 7/8; socket bind failed with EPERM, and the
  outside-sandbox rerun passes all 8. Synthetic Compose config validation passes with loopback
  settings and empty credentials. Primary `git diff --check` passes. Full gates passed in the prior
  implementation session; browser/Compose startup and CI were not repeated in this review.
- Reviewer noted stale current-operation documentation still advertised removed migration/export
  commands. Corrected Local operation below and implementation-plan Deployment wording to the
  dedicated bootstrap and core export function. No runtime changes, athlete data/credentials,
  live upstream requests, commits, pushes, merges, or deployment. All accumulated changes remain
  uncommitted. Next action: review/commit accumulated work and finish outstanding source/Compose/CI
  checks before deployment; no unresolved prior actionable finding remains in this review scope.

## Summary read consistency fixed (current)

- User authorized applying review issue 2's summary fix. `summarizeRuns` and `summarizeHealth` now
  retrieve measurements and coverage through the same transaction connection. Calculations run
  after the transaction closes. API and MCP share these functions; no application reader lock,
  upstream request, schema migration, or changes to summary response contracts were added.
- Added `packages/core/tests/summary-snapshots.test.ts`: disposable file-backed SQLite with separate
  reader/writer connections in WAL mode. A Kysely result plugin publishes a real synthetic import
  after the measurement SELECT and before the coverage SELECT. Both summaries retain the prior
  measurements and coverage together, while the next request sees the newly committed import.
  Both tests fail on the unfixed code specifically because coverage belongs to the newer import.
- Validation: `pnpm --filter @hub/core test` passes all 26 tests; all full gates pass:
  `pnpm run check` (74 files), `pnpm run typecheck` (6 tasks), `pnpm run lint` (7 tasks),
  `pnpm test` (51 tests: DB 6, core 26, API/bootstrap 8, MCP 3, web 8), `pnpm run build`, and
  `git diff --check`. Full tests used socket/subprocess permissions outside the sandbox; Turbo
  emitted read-only cache warnings inside it. Initial test fixtures lacked optional run measurements,
  causing an expected missingness warning; fixtures were completed and tests rerun successfully.
  Biome's initial import-format finding was corrected. A baseline probe without the project's
  `--test-isolation=none` failed to run the test file under the sandbox; retry using that option
  reproduced both intended assertion failures, and fixed code was restored before final validation.
- Worktree/branch `money-hedgehog`, HEAD `50338e6`; this follow-up changes only summaries, its new
  regression test, and tracker/progress docs on top of the preserved accumulated uncommitted edits.
  No athlete data/credentials, live imports, deployment, commit, push, or merge. Compose/browser
  checks were not repeated for this internal read change. The user-set-aside all-null issue remains
  untouched. Next action: review/commit accumulated work and complete outstanding source/Compose/CI
  verification before deployment; no remaining blocker was identified for this summary fix.

## Explicit-date imports only (current)

- User chose full pulls for selected dates, removed history-based import modes and the general CLI,
  and requested a proposal only for summary consistency. The omitted all-null stream finding is
  explicitly set aside by the user; it was not changed. Summary code is also unchanged.
- Import requests now require `mode: range`, start, and end; removed automatic date selection and
  history-derived ranges from core and removed `importedRanges` from the DB repository/facade.
  Every selected date is fetched again regardless of existing coverage, including activity lists,
  details/intervals, streams, and wellness. Existing IDs/dates are updated without duplicates, with
  the existing batch-wide rollback policy and 90-day cap. Missing upstream records still are not
  implicitly deleted; this change removes incremental/history-mode decisions, not retention policy.
- Removed `apps/api/src/cli.ts` and root migration/export commands. Compose now runs a dedicated
  `apps/api/src/migrate.ts` deployment bootstrap before starting services. Normalized export remains
  a core library function. Historical mode labels remain readable as text in sync history; they
  cannot start new imports. No database migration or athlete backfill is required for this change.
- Updated API validation tests, converted DST coverage to explicit dates, replaced obsolete
  reconciliation tests with a full reimport regression, and added a repeatable deployment-bootstrap
  subprocess test. Removed the obsolete CLI tests. Source/operational docs and repository guidance
  reflect the explicit-date workflow; older entries below remain historical execution records.
- Validation: `pnpm run check` passes (73 files), `pnpm run typecheck` passes (6 tasks),
  `pnpm run lint` passes (7 tasks), `pnpm test` passes 49 tests (DB 6, core 24, API/bootstrap 8,
  MCP 3, web 8), `pnpm run build`, and `git diff --check` pass. Full tests ran outside the sandbox
  for socket/subprocess support; Turbo emitted read-only cache warnings inside it.
  Initial Compose config validation lacked required TAILSCALE_IP; retry with disposable synthetic
  environment and `--env-file /dev/null` passes. No Compose startup/browser check was performed.
- Summary proposal (not implemented): retrieve measurements and coverage in one SQLite read
  transaction for run and health summaries; test a concurrent import publication between the reads.
  This preserves readable committed data during imports and avoids application-level reader locks.
- Branch/worktree `money-hedgehog`, HEAD `50338e6`; all accumulated edits remain uncommitted.
  No athlete data/credentials were accessed, live import or migration performed, or commit/push/
  merge/deployment made. Next action: review this explicit-date simplification; implement summary
  consistency only when requested, then complete outstanding source/Compose/CI verification.

## Independent sub-agent code review (current)

- User requested an independent sub-agent review of all accumulated tracked and untracked changes
  against HEAD `50338e6` on branch/worktree `money-hedgehog`. No implementation fixes were made.
- Three P2 findings: `packages/core/src/streams.ts:21` requires `data` before handling an all-null
  stream, so `{type: 'heartrate', allNull: true}` rejects a valid source shape and aborts the batch;
  the previously known summary measurement/coverage snapshot race and sparse-history expansion in
  API `all` remain. The reviewer independently reproduced all three with synthetic mapper and
  in-memory SQLite probes. The public OpenAPI `ActivityStream` schema has no required `data` field
  (`https://intervals.icu/api/v1/docs`, checked this session). This validates the allowed shape,
  rather than establishing its frequency in live athlete responses.
- Reviewer reran `pnpm --filter @hub/core test` (25 passed) and `pnpm --filter @hub/db test`
  (6 passed). Existing stream tests cover explicit null/empty data but omit the missing-property case.
  No further confirmed substantive issue was found in lease recovery, web import control, migration,
  sample pagination, or batch publication. Full gates, browser, Compose, and live imports were not
  repeated for this review. No athlete data or credentials were accessed.
- Public-schema fetch initially failed sandbox DNS (`EAI_AGAIN`); the read-only request succeeded
  outside the sandbox. Documentation changes pass `git diff --check`.
- Next action: fix the three findings with regressions before release. All accumulated changes
  remain uncommitted; no commit, push, merge, or deployment was performed.

## Web-controlled imports and expired-writer recovery (current)

- User chose web UI control for imports without CLI access. Removed the root `sync` script and CLI
  sync branch. Unsupported commands, including `sync all`, are rejected before opening a database.
  CLI migration/export maintenance commands and Compose's migration entry point remain available;
  MCP still has no import tool. HTTP import contracts remain compatible with existing clients.
- Fixed review issue 2: `activeSync` requires a running sync to own the unexpired writer lease.
  Expired/absent/other-owner leases cannot make a stale running history row active. The form disables
  controls only for its pending mutation, so previously cached active status cannot lock it forever.
  The server still rejects genuine overlapping requests with 409. After expiry, the next web import
  acquires the lease and marks abandoned history interrupted. Status reads make no upstream calls and
  do not mutate history. No polling, timers, focus/reconnect refetching, or automatic imports added.
- Validation on Node 26.13.0 / pnpm 12.18.0: `pnpm run check` passes (73 files),
  `pnpm run typecheck` passes (6 tasks), `pnpm run lint` passes (7 tasks), `pnpm test` passes
  all 51 tests (DB 6, core 25, API/maintenance CLI 9, MCP 3, web 8), `pnpm run build` and
  `git diff --check` pass. Full tests ran outside the sandbox for API sockets and subprocesses.
  Turbo emitted read-only cache warnings inside the sandbox. Browser/Compose checks were not run.
- Regressions verify expired leases disappear from status without upstream reads; a web request
  recovers abandoned history and completes; stale cached active status allows a user attempt,
  displays a real 409 overlap error, then permits retry; CLI imports cannot even create a database;
  deployment migration and normalized export still work against disposable synthetic data.
- Continued on worktree/branch `money-hedgehog`, HEAD `50338e6`, preserving accumulated uncommitted
  sample-storage/atomic-import/review changes. This follow-up changes root package scripts,
  `apps/api/src/cli.ts`, API tests, new `apps/api/tests/cli.test.ts`, web App/sync tests,
  DB sync repository, and code-map/implementation-plan/run-analysis/tracker/progress docs.
  No dependency/lockfile change, athlete-data access/write, live import, migration of the athlete DB,
  commit, push, merge, or deployment was performed.
- Remaining confirmed bugs: review issue 1 (summary measurement/coverage snapshot consistency)
  and issue 3 (sparse-history expansion in API `all` reconciliation). The web form uses explicit ranges;
  `all` is not a UI option. Next action: fix the remaining issues with regressions, then review/commit
  and deploy updated services/assets. No new migration is needed for this follow-up.

## Post-import review: three reproduced issues

- User asked whether bugs remain. Reviewed import, lease recovery, coverage, and summary reads;
  reproduced three issues using only in-memory SQLite, synthetic upstream responses, and explicit
  read interleaving (`node --input-type=module` from the root). No implementation changes were made
  in this review; the 47-test result below predates these probes and does not cover them.
- Summary snapshot race (`packages/core/src/summaries.ts`): measurement rows and coverage are
  separate reads. Start with a completed empty import, read summary rows, commit a successful import
  of one synthetic run before the coverage read, then finish the summary. Observed sample_size 0,
  actual run count 1, coverage pointing to the new import, and no warnings. Run and health summaries
  need a consistent SQLite read transaction for measurements and their coverage.
- Expired active sync blocks UI recovery (`packages/db/src/sync.ts`, `apps/web/src/App.tsx`): create
  a running sync, expire its writer lease, then call `dataStatus`. Observed active.status running;
  UI busy remains true because it trusts any active row. Recovery currently runs only after starting
  another sync, while the disabled button prevents that path. Separate running history from a valid
  active lease, or provide equivalent recovery without upstream access.
- Sparse-history expansion (`packages/db/src/sync.ts`): complete imports for two non-adjacent
  synthetic dates, then complete `all`. Before: two separate one-day ranges. After: one continuous
  range containing the unimported gap. `importedRanges` uses each sync's bounding start/end rather
  than its exact `ranges_json`, so subsequent `all` requests can expand beyond imported windows.
- Next action: fix summary snapshot consistency, expired-active recovery/UI behavior, and exact
  reconciliation ranges, adding regression tests for each. The new batch rollback behavior passed
  its existing regression suite; these findings do not establish a rollback failure. No live sync,
  athlete-data read/write, commit, push, merge, or deployment was performed. Documentation-only
  review changes pass `git diff --check`; application gates were not rerun.

## All-or-nothing import policy (current)

- User superseded partial imports: the first request, validation, or persistence error aborts the
  entire requested batch. Imports make no automatic retries, including HTTP 429/5xx/network errors.
  New outcomes are completed, failed, or interrupted; historical partial records remain readable.
- `executeSync` stages only normalized rows in private disposable SQLite under the OS temporary
  directory. No live measurement/coverage changes occur during downloads. `Store.commitImport`
  publishes all staged runs/intervals/samples/wellness, coverage, and completed sync state in one
  transaction after all windows/resources pass; repository writes reuse that transaction. Cancellation,
  validation/write errors, or lost leases discard all staged changes and preserve the prior snapshot.
  Failure history and one sanitized issue remain, with zero upserts. Normal completion/failure removes
  staging files; hard crashes can leave private orphaned staging directories (no credentials/raw JSON).
- Failed/interrupted ranges no longer expand `all` reconciliation. Historical completed/partial
  ranges remain eligible. No schema change or additional migration is needed for this policy.
  Old coverage timestamps remain those of the last successful snapshot; a failed refresh does not
  establish upstream freshness. Agents must continue checking latest sync status and timestamps.
  This is the user's chosen replacement for the earlier per-window partial-import approach; summary
  warning logic itself was not expanded in this change.
- Final validation on Node 26.13.0 / pnpm 12.18.0: `pnpm run check` (72 files),
  `pnpm run typecheck` (6 tasks), `pnpm run lint` (7 tasks), `pnpm test` (47 tests: DB 6,
  core 25 including nested failure cases, API 6, MCP 3, web 7), `pnpm run build`, and
  `git diff --check` all pass. Tests run outside the sandbox for API sockets/MCP stdio; read-only Turbo
  cache warnings occurred inside the sandbox. Docker/Compose and browser checks were not run.
- Synthetic regressions cover first detail/stream/validation/network/rate-limit failures, no retries,
  full rollback after a late publication write error, cancellation and lease takeover, unchanged live
  reads during staging, success publication, later-window failure after earlier resources succeed,
  failed ranges excluded from reconciliation, and the HTTP failed outcome with zero saved records.
- Continued on worktree/branch `money-hedgehog`, HEAD `50338e6`, preserving all earlier uncommitted
  sample-storage/power-test/docs changes. This follow-up modifies core sync/client, DB store/run/sync
  repositories, core/API tests, and code-map/implementation-plan/run-analysis/tracker/progress docs;
  adds `packages/core/tests/atomic-sync.test.ts`. No dependency/lockfile changes, live import, athlete
  database write/reset/migration, commit, push, merge, or deployment were performed.
- Next action: review/commit and restart/deploy updated services to use the new policy. Finish the
  retained-field/unit and discarded-field/log checks, investigate selected power quality, and validate
  Compose/CI for the accumulated revision. Local sample backfill remains complete as verified below.

## Local status verification

- Read-only inspection of this worktree's local SQLite database now confirms migration 003 is
  applied. Follow-up verification after the user's backfill confirms all 17 stored runs have
  stream-import timestamps and stored samples (41,323 samples total). All 146 intervals have start/end
  indices and start/end times. No stored runs remain without imported streams. The latest recorded sync is
  completed with zero rejected records. These are local observations, not production-deployment
  evidence; this agent did not perform the intervening migration or synchronization.
- A user-requested analysis of one stored workout successfully used summaries, exact interval
  boundaries, and aligned samples, including distinct raw/API-selected power. The selected power
  stream has a quality issue that raw samples help expose; availability alone is not validation of
  measurement quality. Athlete context/wiki completeness and a coaching-agent workflow have not
  been audited or implemented as part of this extension.
- The earlier missing-key investigation below is historical: a later worktree configuration allowed
  the explicitly requested read-only HR stream export. There is no established current local
  credentials blocker. No secrets, athlete measurements, or source payloads are recorded here.
- Implementation gates remain the 34-test/check/typecheck/lint/build results below. This status
  refresh changes documentation only; `git diff --check` passes, and application checks were not
  repeated. Worktree/branch remain `money-hedgehog`, HEAD `50338e6`; implementation/tests/docs
  are uncommitted. No push/merge or production deployment has been performed in this session.
- Next action: review/commit the extension and validate deployment/Compose for this revision.
  Local stream backfill is complete for the currently stored runs. Finish retained-field
  source verification and discarded-field/log validation. The former partial-import behavior is
  superseded by the all-or-nothing policy above.
  Then focus on wiki context and the agent coaching workflow. The legacy reset/import checklist
  remains operationally unverified; stream backfill itself needs no database reset.

## Run analysis sample storage

- Worktree `/home/edge33/.paseo/worktrees/09hw1sxp/money-hedgehog`, branch `money-hedgehog`,
  HEAD `50338e6`. Preserved the pre-existing API power regression assertions and two tracker/progress
  edits. User approved normalized core streams and exact interval boundaries, with only minimal
  power-source/corrected-stream identity. Weather, surface, athlete settings, goals, and availability
  remain wiki concerns. See [run-analysis-data.md](run-analysis-data.md) for schema, source evidence,
  limits, HTTP/MCP contracts, and deployment/backfill steps.
- Added immutable migration `003_run_samples`: STRICT `run_samples` with cascading parent FK,
  sample-index primary key, required elapsed seconds, nullable distance/speed/HR/power/raw-power/
  altitude/corrected-altitude/cadence; new nullable interval indices/times/moving time/label and run
  power source/stream-import timestamp. Negative altitude is valid. Migrations 001/002 are unchanged.
  Existing measurements survive migration; old runs have no samples until an explicit manual re-sync.
- Manual sync fetches only the nine approved streams. Validates aligned arrays, original indices,
  monotonic times, bounds, measurements, and exact exclusive interval ends; preserves nulls, zeros,
  irregular recording gaps, and distinct original/corrected streams. Up to 200,000 samples per run,
  existing bounded upstream response/retry/timeouts, no GPS or raw JSON persistence. Run, intervals,
  samples, and sample timestamp replace atomically; failed or invalid stream fetches preserve prior
  records with `STREAMS_UNAVAILABLE`. Valid empty stream responses clear prior samples. Cancellation
  preserves the previous import and releases the lease.
- Added local `GET /api/runs/:id/samples` and shared MCP `get_run_samples`, ordered by original
  sample index with 1–100 rows/page and offset up to 200,000. Sample pages and run detail use read
  transactions. Pages expose their import timestamp so callers can detect re-syncs between pages.
  Normalized export now includes `samples`; API/MCP reads never contact upstream.
- Validation on Node 26.13.0 / pnpm 12.18.0: final `pnpm run check` passes (71 files),
  `pnpm run typecheck` passes (6 tasks), `pnpm run lint` passes (7 tasks), `pnpm test` passes all
  34 tests (DB 6, core 13, API 5, MCP 3, web 7), `pnpm run build` and `git diff --check` pass.
  Tests cover migration preservation, null/zero/negative-altitude semantics, discarded fields,
  malformed/misaligned/oversized streams, sample pagination, atomic rollback after an inserted batch,
  repeated/edited/failed/empty imports, stream cancellation, export, and local-only HTTP/MCP reads.
- The initial full test attempt inside the sandbox failed only API socket binding (`EPERM`) and
  MCP stdio subprocess initialization; full runs outside the sandbox pass. Initial typecheck caught
  an untyped SQLite result in a new test; replaced it with a typed Kysely query and all type checks
  pass. Turbo emitted read-only shared-cache warnings inside the sandbox. Docker/Compose and browser
  checks were not run. This implementation used disposable synthetic data only; no athlete database
  migration/write/reset or live sync was performed. No dependency/lockfile change, commit, push,
  merge, or deployment.
- Uncommitted files: API routes/tests, MCP tools/protocol tests, contracts, core stream/client/
  mapping/sync/export/index and tests, DB migration registry/003/schema/repository/store and tests,
  plus code-map/implementation-plan/minimal-model/progress/run-analysis documentation. Private local
  configuration, data, prior CSV/PNG exports, and wiki remain ignored and untracked.
- Next action: review/deploy the change, run migrations before updated services, and manually
  re-sync explicit date ranges to populate samples and boundaries. Existing unrelated stale-summary
  coverage and remaining legacy field-verification tasks stay pending; this does not complete the
  separate deployment reset/historical import phase.

## Run and interval power API investigation

- Worktree `/home/edge33/.paseo/worktrees/09hw1sxp/money-hedgehog`, branch `money-hedgehog`,
  starting HEAD `50338e6`; initially clean. Traced activity detail GETs (`intervals=true`),
  validation/mapping, SQLite writes/reads, and Fastify response contracts. Supported power fields
  are retained throughout: run `icu_average_watts` becomes `avg_power_w`; interval
  `average_watts`/`max_watts` become `avg_power_w`/`max_power_w`. No runtime fix is indicated.
- Rechecked the public OpenAPI at `https://intervals.icu/api/v1/docs`: these source fields still
  exist, and Activity still has no maximum-power field. Added HTTP regression assertions to the
  existing API tests, covering synthetic manual import through HTTP reads, numeric/zero/null
  interval power, null run power, and numeric power in run detail and list responses.
- Earlier credential-backed findings below recorded upstream null run/interval power despite a
  watts stream. This session could not repeat them: neither the environment nor the main
  checkout's existing `.env` supplied an API key. No authenticated GET, athlete database read,
  stream request, settings change, or live import occurred. Do not treat the historical samples
  as a fresh check of the user's settings or current activities.
- Upstream developer guidance at
  `https://forum.intervals.icu/t/solved-run-power-not-showing/9708` recommends configuring running
  power zones and using Update Activities for missing running power analysis. This is a possible
  cause, not a confirmed diagnosis of the null summaries. Next action: with configured credentials,
  inspect running FTP/zones, selected power source, ignore-power flag, and current activity summary
  fields. Once upstream summaries exist, manually re-sync the affected dates.
- Node 26.13.0 / pnpm 12.18.0: initial `pnpm install --frozen-lockfile` failed on the read-only shared
  store lock; the same command passed outside the sandbox. An initial public-schema shell request
  failed with sandbox DNS restrictions; the read-only request passed outside. The first diagnostic
  invocation could not resolve SQLite from the root workspace; rerunning from `packages/db` exited
  at the missing-credentials guard before reading athlete data.
- Validation: `pnpm exec biome check --write apps/api/tests/app.test.ts` passed; `pnpm --filter
  @hub/core test` passed 9 tests; `pnpm --filter @hub/api exec node --test --test-isolation=none
  --test-name-pattern='HTTP reads|UI sync' tests/app.test.ts` passed 2 focused tests.
  `pnpm run check` passed (68 files), `pnpm --filter @hub/api typecheck` passed, and
  `git diff --check` passed. Uncommitted files: `apps/api/tests/app.test.ts`,
  `docs/minimal-data-model-plan.md`, and `docs/progress.md`. No commit/push/merge performed. Full-suite,
  build, browser, and Compose checks were not run for this test/documentation change.

## Published UI/schema PR (previous)

- User explicitly authorized push and PR publication. Committed the accumulated changes as
  `5656c16` on `clumsy-mole` and pushed to `origin/clumsy-mole` from this worktree.
- Opened [PR #11](https://github.com/edge33/ai-run-coach/pull/11) against `main`: single-page UI,
  date-scoped manual sync (15-day default, 90-day maximum), date-independent 50-entry lists,
  verified activity elevation loss, and migration 002 removing the two unsupported fields.
- All implementation checks passed as recorded below (29 tests). This publication follow-up
  changes only documentation; `git diff --check` passes. Browser/Compose checks were not run.
- Next action: review PR #11 and its CI. Run migrations before starting updated services when
  deploying. No merge, production deployment, athlete database migration/reset, or live sync was
  performed. Local credentials/configuration/data and personal MCP configuration are excluded.

## Remove unsupported fields

- Worktree `/home/edge33/.paseo/worktrees/09hw1sxp/clumsy-mole`, branch `clumsy-mole`,
  HEAD `baba1812ac88394701d950a5e2ce5ce9c3534297`; preserved earlier uncommitted changes.
- Removed `runs.max_power_w` and `run_intervals.elevation_loss_m` from runtime contracts,
  mappings, repository columns, and fixtures. Retained run elevation loss and interval average/max
  power. HTTP/MCP responses and normalized exports now omit the unsupported measurements.
- Added `002_remove_unsupported_measurements`, registered after the unchanged `001_initial`.
  SQLite drops only the two unsupported columns. Fresh and existing databases reach the same
  schema; no record reset or upstream import is required. Updated services must run migrations first.
- Synthetic upgrade test starts at 001 with populated runs/intervals/wellness/lease, applies latest
  twice, and verifies all retained values, indexes, STRICT tables, FK validity and delete cascade.
  Fresh migration checks confirm supported columns remain and removed columns are absent.
- Database tests pass (5). Initial focused core tests caught a new export assertion referring to
  `run_intervals` instead of the existing `intervals` export array; corrected the assertion. Final
  gates now pass: `pnpm run check` (68 files), `pnpm run typecheck` (6 tasks), `pnpm run lint`
  (7 tasks), `pnpm test` (29 tests: database 5, core 9, API 5, MCP 3, web 7), `pnpm run build`,
  and `git diff --check` on Node 26.13.0 / pnpm 12.18.0. Full tests ran outside the sandbox for
  API sockets/MCP subprocesses. Turbo emitted read-only shared-cache warnings inside the sandbox.
  Browser/Compose checks were not run. No athlete database was migrated or reset, no live sync run.
- Final review confirms `001_initial` is unchanged, only the two approved columns are removed,
  retained fields remain in repository/API/MCP/export output, and private configuration/data are
  excluded. The user explicitly authorized committing/pushing the accumulated changes and opening
  a PR. Next action: publish, review PR/CI, and apply migrations when deploying updated services.

## Interval power/elevation investigation

- Same worktree/branch `clumsy-mole`, HEAD `baba1812`; preserved all earlier uncommitted changes.
- Interval average/max power are already mapped from `average_watts`/`max_watts`, unlike the
  explicitly null run-level maximum power. Interval elevation loss remains explicitly null because
  the reviewed upstream Interval schema does not provide it.
- Read-only SQLite and three upstream activity-detail GETs confirmed sampled interval average/max
  watts are explicitly null, while `total_elevation_loss` is absent. Only aggregate counts and field
  presence/type metadata were printed; no athlete measurements, credentials, identifiers, or raw
  payloads were retained. No streams fetched, sync triggered, settings changed, or records written.
- Strengthened synthetic regression coverage for interval power mapping and persistence, including
  zero, null/absent, and rejection of negative values. No production mapping change is warranted
  from these samples. `pnpm run check` (67 files), `pnpm --filter @hub/core test` (9 tests),
  `pnpm --filter @hub/core typecheck`, and `git diff --check` passed on Node 26.13.0 / pnpm 12.18.0.
  Full-suite/build/browser/Compose checks were not repeated for this test/documentation follow-up.
- Changes remain uncommitted alongside the earlier UI/API/contracts/database/core/docs/lockfile
  changes; this follow-up modifies only core tests and the two progress/tracker documents.
- Next action: review the regression coverage; investigate upstream running power configuration/processing
  if power analysis is desired, then manually re-sync those dates after upstream values exist.
  Deriving missing statistics from streams would change the approved scope.

## Browse all stored records

- Continued in `/home/edge33/.paseo/worktrees/09hw1sxp/clumsy-mole`, branch `clumsy-mole`,
  HEAD `baba1812ac88394701d950a5e2ce5ce9c3534297`; preserved all earlier uncommitted changes.
- Sync dates now control only imports. Both lists always read all stored records, newest first,
  with independent offsets and a 50-entry page size. Date edits, including invalid selections,
  do not hide lists, change their queries, or reset pagination. Sync still defaults to 15 days,
  enforces the 90-day maximum, and refreshes local lists when the import settles.
- Added optional paired dates to the HTTP record-list contract; omitted dates request all records.
  HTTP run/health pages are capped at 50. Repository reads support omitting the range without
  arbitrary historical date cutoffs. Existing filtered reads and bounded MCP contracts remain.
- Synthetic API regression seeds 52 records per resource including older history, checks full totals,
  newest-first pagination without duplicates, rejects limits over 50 and unpaired dates, and verifies
  zero upstream calls. UI tests check separate pagination and unchanged lists after sync-date edits.
- `pnpm run typecheck` (6 tasks) and `pnpm test` (28 tests: database 4, core 9, API 5, MCP 3,
  web 7) passed on Node 26.13.0 / pnpm 12.18.0. Full tests ran outside the sandbox for API
  sockets/MCP subprocesses. `pnpm run check` (67 files), `pnpm run lint` (7 tasks),
  `pnpm run build`, and `git diff --check` also passed. Turbo reported read-only shared-cache
  warnings inside the sandbox. Browser/Compose checks were not run.
- Reviewed the final API/repository diff, optional range validation, page bounds, and UI queries.
  Changes remain uncommitted across UI/API/contracts/database/core, tests/docs, and router
  dependency/lockfile cleanup. Next action: review accumulated changes. No blockers, live sync,
  or athlete-data access for this follow-up; no push, merge, or deployment.

## Power/elevation mapping investigation

- Same worktree/branch `clumsy-mole`, HEAD `baba1812`; earlier uncommitted UI/date changes preserved.
- Traced source schema, mapping, sync detail merge, contracts, and database upserts. Run maximum
  power and elevation loss were explicitly null; average power maps only `icu_average_watts`.
- Read the current public OpenAPI at `https://intervals.icu/api/v1/docs`: Activity includes
  `icu_average_watts` and `total_elevation_loss`, but no maximum-power field. Interval includes
  average/max watts but no elevation-loss field. Updated only the confirmed activity loss mapping.
- At the user's request to investigate stored data, used read-only SQLite and upstream GETs for
  three existing runs. Printed only aggregate non-null counts, field presence/types, and power flags;
  no identifiers, measurements, raw payloads, or credentials were retained. Samples returned null
  average power while advertising a watts stream/device power; power was not flagged ignored.
  This confirms null average power is upstream in those samples, without establishing its upstream
  processing cause. No streams were fetched, imports triggered, or athlete records modified.
- Added synthetic mapping/persistence coverage for numeric elevation loss and average power,
  recorded zero, missing values, and invalid negative loss. On Node 26.13.0 / pnpm 12.18.0,
  `pnpm run check` (67 files), `pnpm run typecheck` (6 tasks),
  `pnpm --filter @hub/core test` (9 tests), and `git diff --check` passed. Turbo emitted
  read-only shared-cache warnings. Full-suite/build/browser/Compose gates were not repeated.
- Developer guidance at `https://forum.intervals.icu/t/solved-run-power-not-showing/9708/2`
  says running power analysis requires configured zones and updating activities. This is a possible
  upstream follow-up, not a confirmed diagnosis of the user's settings; none were changed.
- Next action: review the mapping and check upstream running power configuration/processing. Existing records need a user-triggered re-sync
  of their dates to populate elevation loss after deploying the fix. Run maximum power remains
  null; deriving it or average power from streams would change the approved ingestion scope.

## Date selection and bounded sync

- Continued in `/home/edge33/.paseo/worktrees/09hw1sxp/clumsy-mole`, branch `clumsy-mole`,
  HEAD `baba1812ac88394701d950a5e2ce5ce9c3534297`; preserved earlier uncommitted UI changes.
- Added labeled native start/end date inputs, defaulting to today and the preceding 14 local dates.
  Selection controls local lists and sends `{ mode: 'range', start, end }` only after Sync is clicked.
  Date changes reset pagination. Pending sync disables the date fields and button.
- Defined three months as 90 inclusive local dates and labeled this explicitly. UI blocks empty,
  invalid, reversed, future, and oversized ranges without reading/syncing those ranges. Core validates
  explicit ranges with the same 90-day maximum before acquiring a lease or making upstream calls;
  API returns 400 for violations. Recent sync/empty-history fallback now default to 15 dates.
  Reconciliation of existing imported history still uses bounded windows; larger historical imports
  should be split into explicit ranges.
- Overlap regression confirms existing runs and wellness measurements are updated without duplicates;
  detail failure preserves prior runs/intervals. Existing writer leases reject concurrent imports.
- Node 26.13.0 / pnpm 12.18.0: `pnpm run check` (67 files), `pnpm run typecheck` (6 tasks),
  `pnpm run lint` (7 tasks), `pnpm test` (27 tests: database 4, core 9, API 4, MCP 3, web 7),
  `pnpm run build`, and `git diff --check` passed. Full tests ran outside the sandbox for API
  sockets/MCP subprocesses. Turbo emitted read-only shared-cache warnings inside the sandbox,
  without failing successful lint/typecheck/build checks. Browser and Compose checks were not run.
- Reviewed accumulated changes, including range limits, overlap handling, and dependency cleanup.
  Web/API tests, contracts/core sync/tests, UI/docs, and router dependency/lockfile changes remain
  uncommitted. Next action: review the simplified page with date selection. No implementation
  blockers, live sync, athlete-data access, push, merge, or deployment.

## Latest 30-day sync

- Continued in the same `clumsy-mole` worktree/branch at `baba1812`; preserved all uncommitted
  single-page UI changes. Recent sync now retrieves today and the preceding 29 local dates for
  both runs and health, matching the displayed window. The empty-history fallback uses the same
  window; `all` still only reconciles imported ranges when history exists.
- Updated UI copy, sync fixture dates, and architecture/tracker docs. Added a synthetic regression
  test checking actual upstream run/health request bounds across a month boundary and DST change.
- Validation passed on Node 26.13.0 / pnpm 12.18.0: `pnpm run check` (67 files),
  `pnpm run typecheck` (6 tasks), `pnpm --filter @hub/core test` (8 tests),
  `pnpm --filter @hub/web test` (6 tests), `pnpm run build`, and `git diff --check`.
  Turbo emitted read-only shared-cache warnings; checks still passed. Full suite, separate lint,
  browser, and Compose checks were not repeated for this follow-up.
- Next action: review the UI and 30-day default together. Core sync/test changes, web UI/tests,
  documentation, and router dependency/lockfile cleanup remain uncommitted on `clumsy-mole`.
  No blockers, live sync, push, merge, or deployment.

## Single-page UI

- Worktree `/home/edge33/.paseo/worktrees/09hw1sxp/clumsy-mole`, branch `clumsy-mole`,
  starting commit `baba1812ac88394701d950a5e2ce5ce9c3534297`; initial worktree was clean.
- Replaced the dashboard with one plain page: Sync, runs, and daily health lists. Removed the
  sidebar, routes, overview, run details, charts, summaries, sync options/history, branding, and
  decorative styles. Removed the unused React Router dependency and updated the pnpm lockfile.
- Lists show the last 30 local dates with bounded pagination. Runs show timestamp, known indoor
  state, distance, moving time, and average HR. Daily health shows resting HR, HRV, sleep hours,
  and weight, including days without runs. Missing values stay distinct from zero.
- Sync manually imports the last 30 dates, disables the button while pending or already active,
  shows final status (including partial failures), and refreshes local queries. Page reads never
  start imports. Historical/range sync remains available through the CLI; API/MCP are unchanged.
- Node `v26.13.0` / pnpm `12.18.0`: frozen install passed outside the sandbox after the shared
  pnpm store lock was read-only inside it. Focused `pnpm --filter @hub/web test` passed 6 tests,
  covering no import before click, pending controls, partial feedback, refreshing both lists,
  measurements/units/missingness, error states, and pagination.
- Full gates passed: `pnpm run check` (67 files), `pnpm run typecheck` (6 tasks), `pnpm run lint`
  (7 tasks), `pnpm test` (24 tests: database 4, core 7, API 4, MCP 3, web 6), and `pnpm run build`.
  The initial sandbox suite failed API socket binding with `listen EPERM` and interrupted the MCP
  subprocess; the complete rerun outside the sandbox passed. Turbo emitted read-only shared-cache
  warnings inside the sandbox, without affecting successful lint/typecheck/build outcomes.
- `git diff --check` passed; reviewed the final diff, including the router-only lockfile deletions.
  Docker/Compose, browser visual checks, and browser E2E were not run. All validation used synthetic
  records. Changes remain uncommitted in the worktree above; no implementation blockers remain.
- Next action: review the simplified page. Existing upstream field verification,
  discarded-field coverage, stale-summary-coverage fix, deployment reset, and historical import
  remain separate pending work. No live sync, athlete-data access, push, merge, or deployment.

## Request-bound manual sync

- Continued PR #10 in `/tmp/ai-run-coach-worktrees/simplify-api-sync` on
  `refactor/simplify-api-sync`, starting at `a6579e0`. The user requested direct UI-triggered
  imports without background execution; this supersedes the earlier implementation below.
- `POST /api/sync-runs` now awaits `beginSync`/`executeSync` and returns `200` with the final
  completed/partial/failed/interrupted sync record. Removed the sync manager, event emitter,
  SSE endpoint, progress callback, and browser EventSource hook. SQLite schema is unchanged.
- Added a labeled sync icon in the top bar using the same mutation as the synchronization
  page. No import starts on page load. Controls stay disabled during the request; the UI shows
  the final outcome, including partial failures, and refreshes local queries when it settles.
- Client disconnection and API shutdown abort upstream requests and retry waits. The importer
  finalizes interruption and releases the writer lease. A competing sync returns `409` with
  the active sync; the response schema explicitly retains that field.
- API tests verify the request remains pending until import finishes, concurrent requests are
  rejected, shutdown preserves stored data, and actual HTTP disconnection cancels the import.
  UI tests verify zero imports before a click, the icon's request payload, disabled controls,
  partial-result feedback, and local-query refresh after completion.
- On Node `v26.13.0` / pnpm `12.18.0`, `pnpm run check` (70 files), `pnpm run typecheck`
  (6 tasks), `pnpm run lint` (7 tasks), `pnpm test` (22 tests: database 4, core 7, API 4,
  MCP 3, web 4), and `pnpm run build` all pass outside the sandbox. The first focused API run
  exposed a response schema stripping `active` from busy errors; adding the explicit `409`
  schema fixed it, and all subsequent checks pass. `git diff --check` passes.
- Docker/Compose and browser E2E were not rerun. Imports must finish within the deployed
  proxy's request timeout (currently 300 seconds); a proxy disconnect interrupts the import,
  so large historical imports may need smaller explicit date ranges.
- Next action: review updated PR #10 and its CI. The stale-summary-coverage issue, source-field
  verification, discarded-field coverage, deployment reset, and historical import remain pending.
  No merge, production deployment, athlete-data access, or live sync was performed.

## Earlier API simplification: background synchronization

- Readability follow-up: added blank lines between declarations, route registrations, validation,
  execution, cleanup, and test phases throughout the API and core sync/client code. Compared all
  12 affected code files against their pre-format contents with whitespace removed: identical.
  `pnpm run check` and `git diff --check` pass. No tests were rerun for whitespace-only edits;
  the 20-test validation below covers the same behavior. Worktree/branch and next action are unchanged.

- Worktree: `/tmp/ai-run-coach-worktrees/simplify-api-sync`; branch
  `refactor/simplify-api-sync`, based on freshly fetched `origin/main` at `a0a8f61`.
  Publication is authorized by the user. The current main commit contains PR #6; older PR-publishing next
  actions below are historical.
- The minimum persisted model remains runs, ordered run intervals, wellness rows, and sync
  metadata. No schema changes or athlete-data reset are needed for this refactor.
- Replaced the API child-process worker, IPC parsing, child registry, and signal/kill cleanup
  with one in-process background task. Removed `apps/api/src/worker.ts`. Existing endpoints,
  manual sync modes, SSE progress, history, issues, and local-only reads remain available.
- The SQLite writer lease still excludes competing API/CLI imports. Shutdown aborts active
  upstream requests and retry waits, awaits finalization, and records interruption. Since sync
  now shares the API process, synchronous parsing/database work also shares its event loop;
  existing request, response, and window bounds remain in place. Abrupt process termination
  still relies on lease expiry and the existing recovery at the next sync.
- Simplified busy-error handling to async/await. Added synthetic tests for HTTP-triggered
  import/completion, concurrent-start rejection, progress delivery, cancellation, preservation
  of stored wellness, lease release, and cancellation during rate-limit backoff.
- Node `v26.13.0`, pnpm `12.18.0`: `pnpm install --frozen-lockfile` passed outside the sandbox
  after the sandbox could not open pnpm's store lock. `pnpm run check` (71 files),
  `pnpm run typecheck` (6 tasks), and `pnpm run lint` (7 tasks) passed. Turbo reported
  sandbox shared-cache write warnings.
- `pnpm --filter @hub/api test` passed all 3 tests after correcting the new fixtures' allowed
  origin and explicit empty interval array. The sandbox full suite passed core/API/database
  tests but failed the MCP stdio subprocess with `Connection closed`; `pnpm test` outside
  the sandbox passed all 20 tests (database 4, core 7, API 3, MCP 3, web 3).
  `pnpm run build` passed using the unchanged frontend's Turbo cache.
- `TAILSCALE_IP=127.0.0.1 APP_ORIGINS=http://127.0.0.1:8080 INTERVALS_API_KEY='' docker compose
  -p running-data-hub-api-simplification config --quiet` passed. Container build/start/smoke
  checks were not rerun; the sandbox cannot access the Docker daemon. `git diff --check` passed.
- Next action: review the API simplification PR and its CI results; identify any remaining endpoints or UI
  features to remove before shrinking the public API. The stale-summary-coverage fix remains
  pending separately, as do source verification, discarded-field coverage, deployment reset,
  and historical import. This change is prepared for the requested commit, push, and PR publication;
  no merge, live import, or athlete-data access is authorized by this publication request.

## PR #6 rebase onto current main

- On 2026-11-09, rebased `feature/minimal-data-model` in
  `/home/edge33/.paseo/worktrees/09hw1sxp/mellow-parrot` onto fetched `origin/main`
  at `95040c1`. The earlier model implementation through `d4d57ec` is tree-identical
  to squash commit `3acec09`; only the four follow-up commits were replayed.
- Resolved the `docs/progress.md` conflict by retaining both the main-branch Node/pnpm
  migration history and the PR handoff notes. Updated `AGENTS.md` validation instructions
  to the inherited pnpm tooling. Historical commit references below describe pre-rebase state.
- On Node 26.13.0 and pnpm 12.18.0, `pnpm install --frozen-lockfile`, `pnpm run check`
  (72 files), `pnpm run typecheck` (6 workspaces), `pnpm run lint` (7 workspaces),
  `pnpm test` (17 tests: database 4, core 6, API 1, MCP 3, web 3), and `pnpm run build`
  all passed. Install and checks ran outside the sandbox after the initial sandbox install
  failed to open the shared pnpm store lock. `git diff --check` passed.
- Reviewed `git range-diff` against the original four commits: application and regression-test
  changes are preserved; differences are limited to handoff context. Compose was not rerun.
- The user explicitly approved publishing after automatic review initially blocked the push.
  Publish with an explicit lease against verified original PR head
  `1f2ff2316ea9a360a218b8fe97be0ad4f7f83352`.
- Next action: verify the published PR #6 head and CI. The stale-coverage
  finding, upstream field verification, remaining log-discard coverage, and separate reset/import
  remain pending.
  No merge, athlete-data access, reset, or live import was performed.

## Node 26 and pnpm migration

- Follow-up work remains in `/home/edge33/.paseo/worktrees/09hw1sxp/roasted-penguin`
  on branch `roasted-penguin`, continuing the migration from `ef3ae4d`.
- The active Paseo shell now resolves Node 26.13.0 and pnpm 12.18.0. `.nvmrc`, the root
  Node engine, Docker build/runtime images, and CI now select Node 26. CI installs the
  package-manager version pinned in `package.json` before configuring the pnpm cache.
- Updated `@types/node` to 26.6.6 and regenerated `pnpm-lock.yaml`. Turbo now tracks the
  pnpm lockfile. Docker uses frozen pnpm installs in separate development and production
  stages and retains workspace symlinks to TypeScript sources outside `node_modules`.
- Updated current architecture, review, resume, and local operation instructions to pnpm;
  earlier validation records retain the tool versions actually used.
- Removed `scripts/compose-lifecycle.mjs` and its CI step at the user's request. Compose
  build/start, service health checks, Nginx configuration validation, and smoke tests remain.
- `pnpm install --no-frozen-lockfile` and `pnpm install --frozen-lockfile` pass outside the
  sandbox; the sandbox cannot write the shared pnpm store operation lock.
- `pnpm run check`, `pnpm run typecheck`, `pnpm run lint`, and `pnpm run build` pass on
  Node 26.13.0. Turbo emitted shared-cache write warnings inside the sandbox.
- `pnpm test` passes all 17 tests outside the sandbox (database 4, core 6, API 1, MCP 3,
  web 3). The sandbox run closed the MCP stdio connection and interrupted other suites.
- Fresh Docker development/production installs and frontend build pass without build approvals:
  `better-sqlite3@13.0.3` ships prebuilt binaries, declares `gypfile: false`, and has no install hook.
- `TAILSCALE_IP=127.0.0.1 APP_ORIGINS=http://127.0.0.1:8080 INTERVALS_API_KEY='' docker compose
  -p running-data-hub-validation config --quiet` and `up --build -d --wait` pass. Docker
  used the classic builder because Buildx is absent. All services reached healthy state.
- Container verification confirms Node v26.13.0 and `@hub/db` resolving to
  `file:///app/packages/db/src/index.ts`.
- Before its removal, `node scripts/compose-lifecycle.mjs` passed after the workspace fix: SSE progress/heartbeat,
  persistence after recreation, shared SQLite integrity, health, and port isolation.
  `node scripts/compose-smoke.mjs` and `docker compose -p running-data-hub-validation exec
  nginx nginx -t` pass after lifecycle recreation. An earlier smoke attempt overlapped the
  active lifecycle fixture and failed its expected idle-sync assertion; the sequential rerun passes.
- `TAILSCALE_IP=127.0.0.1 docker compose -p running-data-hub-validation down -v` removed
  only the disposable validation containers, network, and synthetic database/wiki volumes.
- `pnpm run check` and `git diff --check` pass after removing the lifecycle script and CI step.
  Docker was not rerun for this removal; the migration validation above ran before removal.
- Next action: review the migration diff. No remaining migration blockers were found. No push,
  merge, production deployment, live sync, or athlete-data reset was performed.

## Agent guide handoff

- Updated the existing root `AGENTS.md` on `docs/agent-handoff-guide` to reference the current
  minimal-model branch and tracker, validation commands, and machine-to-machine handoff rules.
- The documentation branch starts at `d4d57ec`. At the user's request, all remaining sync fix,
  regression test, and tracker/progress changes were committed as `8683e42` on
  `feature/minimal-data-model`; the agent-guide commit was included there as `a138460`.
- On 2026-10-09, `npm run test -w @hub/core` passed all 6 tests and `npm run check` passed
  on 73 files; `npm run typecheck` passed all 6 TypeScript workspaces. The stale-coverage
  finding remains pending; no full suite or Compose rerun was made.
- Validation: `git diff --check` passed. No application tests were run for this documentation-only
  change. The implementation follow-up remains in the original worktree's tracker and progress log.

## Minimal data model implementation

- Branch: `feature/minimal-data-model`, based on fetched `origin/main` at `9b3aeb5`.
  [PR #5](https://github.com/edge33/ai-run-coach/pull/5) is merged, as verified on 2026-10-09.
  Follow-up [PR #6](https://github.com/edge33/ai-run-coach/pull/6) contains the committed detail-failure
  fix, regression test, agent guide, and handoff notes; CI is pending. No merge was performed by
  this handoff session.
- The fresh SQLite migration now uses `STRICT` domain tables. Repository writes parse the shared
  Zod contracts, and run date queries include the maximum valid date. Source IDs, wellness rows,
  ordered intervals, nullable measurements, and same-day form follow the approved tracker.
- Manual sync retains only normalized fields, skips activities whose detail fetch or validation
  fails, preserves previously imported run records and intervals, and does not run on reads.
  API, MCP, web, summaries, export, Compose, and lifecycle checks use the
  new model. Snapshot and backup/restore functionality and configuration have been removed.
- `npm run check`, `npm run typecheck`, `npm run lint`, `npm test` (outside the sandbox for the MCP
  stdio subprocess), and `npm run build` pass locally. Database, core, API, MCP, and web tests pass.
  A sandbox-only `npm test` attempt closed the MCP stdio connection; the same suite passed outside.
- The disposable `running-data-hub-validation` Compose project passed `config --quiet`,
  `up --build -d --wait`, `nginx -t`, `scripts/compose-smoke.mjs`, and
  `scripts/compose-lifecycle.mjs` with synthetic data. `down -v` removed only its volumes.
- Both application jobs on draft PR #5 passed the complete GitHub workflow, including Compose.
- Upstream field evidence is recorded in the tracker. The official forum model supports wellness
  keys, activity speeds, and interval `max_watts`; run maximum power and elevation loss remain null
  because a supported source key was not confirmed. A live credential-backed import has not run.
- Next action: address the stale-coverage finding in the second adversarial review below, then
  finish source-key verification if current official OpenAPI access becomes available and complete
  remaining mapping/log-discard test coverage. The one-time athlete-data reset and explicit
  historical import remain pending; do not infer a historical range from `all` on an empty database.

## Adversarial review of draft PR #5

- Reviewed the local `feature/minimal-data-model` head against fetched `origin/main` on
  2026-09-27. `gh pr view 5 --repo edge33/ai-run-coach --json ...` could not connect to
  `api.github.com`, so live PR metadata and comments were not inspected.
- A disposable in-memory SQLite sync probe completed one import with detail-only distance and
  heart rate, then repeated it with a sparse activity list row and a 404 detail response. The
  second sync was `partial`, but the existing run's `distance_m` and `avg_hr_bpm` changed from
  `5000`/`150` to null. The prior runs coverage row remained. Review finding: preserve valid
  run measurements when detail retrieval fails.
- A second disposable in-memory probe returned a list activity dated `2026-09-20` and same-ID
  detail dated `2026-09-21`. The range sync saved the current detail date. The user confirmed
  that this is acceptable, so the second review finding was withdrawn; no date check was added.
- The detail-failure path was changed to record `DETAIL_UNAVAILABLE` and skip that activity
  without saving its list row. Existing measurements, provenance, status, and intervals remain
  unchanged; a new activity with unavailable detail is not inserted. The window remains partial.
  The focused core test now covers both existing and new run IDs with 404 detail responses.
  After the final test extension, `npm run test -w @hub/core` passed all 6 tests,
  `npm run typecheck` passed all 6 TypeScript workspaces, `npm run check` checked 73 files,
  and `npm run lint` passed all 7 workspaces. The full suite and Compose were not rerun for
  this focused sync change.
- No athlete data or persistent database was touched. Source verification, remaining mapping and
  log-discard coverage, and the separate reset/import remain pending.

## Second adversarial review

- Reviewed the current worktree, including the uncommitted detail-failure fix, against fetched
  `origin/main`. A disposable in-memory SQLite probe first synchronized an empty 2026-09-20 runs
  window successfully, then returned a newly listed run whose detail request returned 404.
- The second sync was `partial` and correctly skipped the new run, but `summarizeRuns` returned
  `sample_size: 0`, distance `0`, and no warnings. The old runs coverage row remained and was
  treated as full coverage despite the newer incomplete attempt. This can present an incomplete
  range as a confident zero. No athlete data or persistent database was used.
- Next action: make run-summary coverage and warnings account for newer partial attempts that
  overlap an older completed coverage row, or invalidate the affected coverage when such an
  attempt detects an unimported run. Add a regression test for the empty-success/new-run-404
  sequence before treating the fix as complete.

## Pre-redesign state (historical)

- Active branch: `refactor/readable-modules`, created from fetched `origin/main` (`9410b58`).
  Published as [PR #4](https://github.com/edge33/ai-run-coach/pull/4) against `main`; no merge
  is authorized. The worktree was clean when the refactor began.
- `git push -u origin refactor/readable-modules` and `gh pr create --base main --head
  refactor/readable-modules ...` succeeded. GitHub CI is tracked on the PR; local validation
  results below describe the completed refactor before publication.
- Split database connection management, row types, migrations, and run/health/lease/sync repositories
  into focused modules while preserving the public Store API and all query/transaction bodies.
- Split API routes by feature, extracted compressed snapshot storage from ingestion, and separated
  the run-details screen and sync-progress hook from their parent UI files.
- Added [code-map.md](code-map.md) to explain module responsibilities and review entry points.
- Registered the local stdio MCP server in this workstation's Codex configuration as
  `running_data_hub`, using Node 24.21.0, the repository `.env`, and `apps/mcp/src/stdio.ts`.
  This personal Codex configuration is outside Git.
- Removed the Playwright browser suite, its synthetic server, configuration, npm script/dependency,
  and browser-install/test CI steps. Browser E2E coverage is deferred at the user's request.
  Unit, integration, MCP protocol, and Compose checks remain. Keep ignore rules for old local
  browser reports so generated artifacts cannot enter Git or Docker image layers.
- API, MCP, and private libraries run TypeScript sources directly on Node 24.21.0. Only the web
  workspace has a build task. Library exports resolve through npm workspace symlinks to source
  outside `node_modules`; do not replace these with copied TypeScript packages in `node_modules`.
- Removed library compiler/watch builds and build tsconfigs. The shared config enforces no emit,
  erasable syntax, explicit TypeScript imports, and type-only imports.
- Turbo uses a transitive dependency task to invalidate downstream caches when library sources
  change, without compiling dependencies. API/MCP Node watchers follow imported library sources.
- Docker has separate frontend-build and production-dependency stages; runtime ships library source.
  CI runs type checking and tests before the frontend build to verify a build-free fresh checkout.

## Implemented

- Turborepo/pnpm workspace, pinned Node and dependencies, shared TypeScript config, and Biome config.
- SQLite/Kysely migrations, normalized run/interval/health storage, sync metadata, coverage, issues,
  snapshots, atomic writer leases, WAL, and repository queries.
- Validated Intervals.icu client and manual recent/range/all ingestion with retries, transactional
  upserts, snapshots, detail handling, and conservative failure semantics.
- Deterministic run and health summaries with units, sample counts, missingness, and coverage warnings.
- Fastify API, sync child worker, persisted progress, SSE, input bounds, and host/origin validation.
- Vite React dashboard with Overview, Runs, Health, and Synchronization pages.
- Markdown athlete wiki with validation, provenance, revision journal, pending changes, confirmation,
  locking, and scoped access.
- Eleven semantic MCP tools shared by stdio and stateless Streamable HTTP transports.
- Coordinated SQLite/wiki/snapshot backup, restore, and export commands.
- Multi-stage Dockerfile, SQLite-only Compose services, Nginx reverse proxy, health checks, CI, unit,
  integration, protocol, and Compose smoke tests.

## Validation results

Validated this readability refactor on 2026-09-23 with Node 24.21.0 and npm 11.19.0:

- `npm run check:fix` formatted the extracted modules; `npm run check` passed without warnings.
- `npm run typecheck` and `npm run lint` passed across all workspaces.
- Initial sandbox `npm test` passed database, core, and API tests, but the MCP stdio subprocess
  closed its connection; Turbo then interrupted web tests. `npm test` outside the sandbox passed
  all 17 tests (database 3, core 7, API 1, MCP 3, web 3), with no cached test results.
- `npm run build` passed the frontend production build.
- Compared extracted database method bodies with `git show HEAD:packages/db/src/index.ts`, ignoring
  whitespace: all matched. Public method signatures, arguments, defaults, and exports were reviewed.
- `git diff --check` passed. Docker/Compose and browser checks were not rerun for this refactor;
  browser E2E coverage remains deferred at the user's request.

- `codex mcp get running_data_hub --json` reported an enabled stdio connection. A direct MCP
  client connection outside the sandbox listed all 11 tools and successfully called
  `get_athlete_context`. The initial sandbox subprocess attempt closed its connection,
  matching the earlier MCP protocol test limitation. Start a new Codex session to load the server.

## Previous main-branch Docker validation (not rerun for this refactor)

- `TAILSCALE_IP=127.0.0.1 APP_ORIGINS=http://127.0.0.1:8080 INTERVALS_API_KEY='' docker compose
  -p running-data-hub-validation up --build -d --wait` passed: runtime/proxy builds, migrations,
  and all service health checks. Docker used its classic builder because Buildx is absent.
- A Node assertion inside the API container verified that all three `@hub` libraries resolve to
  `/app/packages/<name>/src/index.ts`, import successfully, and have no `dist` directory.
- `TAILSCALE_IP=127.0.0.1 docker compose -p running-data-hub-validation exec nginx nginx -t`
  and `node scripts/compose-smoke.mjs` passed: SPA deep links, missing-asset/API 404s, MCP
  initialization/list/call, and rejected untrusted origins through the proxy.

- `node scripts/compose-lifecycle.mjs` passed SSE progress/heartbeat streaming, persistence across
  service recreation, shared SQLite, integrity, port isolation, and coordinated backup/restore.
- `TAILSCALE_IP=127.0.0.1 docker compose -p running-data-hub-validation down -v` removed the
  disposable validation stack and synthetic-data volumes. No athlete data was used.
- Previous recommendation was to review the refactor PR against `main`; the current next action
  is the minimal-model tracker above. No push or merge is authorized by this documentation task.

## Environment-dependent follow-up

- No live Intervals.icu credentials were supplied. Ingestion was validated with synthetic upstream
  responses; a real athlete import remains a deployment smoke check initiated by the user.
- Tailscale exposure was validated with loopback substituted for the address. Access from another
  tailnet device remains a deployment check after configuring the real address and matching origin.
- No production deployment or merge has been performed.

## Resume commands

Use Node 26.13.0 and pnpm 12.18.0. Run `nvm use` and ensure the pinned pnpm version is
available. On a fresh checkout run `pnpm install --frozen-lockfile` first.
Run from the repository root:

```bash
git status --short
docker version
docker compose version

pnpm run check
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm test

export TAILSCALE_IP=127.0.0.1 APP_ORIGINS=http://127.0.0.1:8080 INTERVALS_API_KEY=''
docker compose -p running-data-hub-validation config --quiet
docker compose -p running-data-hub-validation up --build -d --wait
docker compose -p running-data-hub-validation exec nginx nginx -t
SMOKE_ORIGIN=http://127.0.0.1:8080 node scripts/compose-smoke.mjs
docker compose -p running-data-hub-validation ps
docker compose -p running-data-hub-validation logs
docker compose -p running-data-hub-validation down -v
```

Use `127.0.0.1` only for local validation. Homelab deployment must set `TAILSCALE_IP` to the host’s
actual Tailscale address and set `APP_ORIGINS` to the matching externally used origin.
The final `down -v` deletes only that validation project's volumes; never use it against athlete data.
Docker daemon access must be available. In restricted agent environments, Docker and subprocess
tests may require execution outside the sandbox.

## Local operation

Copy `.env.example` to `.env`, configure local paths/origins and optional Intervals credentials, then
run the deployment bootstrap with `node --env-file-if-exists=.env apps/api/src/migrate.ts`, then
`pnpm run dev` (no build prerequisite). The web app runs on port 5173, the API on
3000, and HTTP MCP on 3001. `pnpm run build` produces only the frontend assets. `pnpm run mcp` starts the stdio transport. On this workstation, Codex starts it through the
registered `running_data_hub` MCP server; a new Codex session is needed after registration.
The single page’s Sync button explicitly starts an import; service startup does not.
The general CLI has been removed. Use the web date selection for historical imports in
windows of at most 90 inclusive days. Compose runs the dedicated migration bootstrap before services.
Normalized JSON export remains available through the core `exportData` library function.
The legacy backup and restore commands have been removed. The deployment reset remains a separate,
one-time action in the minimal-model tracker.

## Update discipline

Every agent that changes implementation state, validation results, blockers, or the recommended next
action must update this file in the same change. Replace stale claims instead of appending ambiguous
status notes. Include the command, result, and any environment-dependent limitation.
