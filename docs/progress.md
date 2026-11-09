# Running Data Hub progress

Last updated: 2026-11-09

## Request-bound manual sync (current)

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
run `pnpm run migrate` and `pnpm run dev` (no build prerequisite). The web app runs on port 5173, the API on
3000, and HTTP MCP on 3001. `pnpm run build` produces only the frontend assets. `pnpm run mcp` starts the stdio transport. On this workstation, Codex starts it through the
registered `running_data_hub` MCP server; a new Codex session is needed after registration.
The Synchronization view or
`pnpm run sync` explicitly starts an import; service startup does not.

`pnpm run export DESTINATION` writes normalized JSON records into a new empty directory.
The legacy backup and restore commands have been removed. The deployment reset remains a separate,
one-time action in the minimal-model tracker.

## Update discipline

Every agent that changes implementation state, validation results, blockers, or the recommended next
action must update this file in the same change. Replace stale claims instead of appending ambiguous
status notes. Include the command, result, and any environment-dependent limitation.
