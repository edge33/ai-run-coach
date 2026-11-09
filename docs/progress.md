# Running Data Hub progress

Last updated: 2026-11-09

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

## Minimal data model implementation

- Branch: `feature/minimal-data-model`, based on fetched `origin/main` at `9b3aeb5`.
  Draft [PR #5](https://github.com/edge33/ai-run-coach/pull/5) remains open; no merge was performed.
- The fresh SQLite migration now uses `STRICT` domain tables. Repository writes parse the shared
  Zod contracts, and run date queries include the maximum valid date. Source IDs, wellness rows,
  ordered intervals, nullable measurements, and same-day form follow the approved tracker.
- Manual sync retains only normalized fields, handles detail failure without deleting intervals,
  and does not run on reads. API, MCP, web, summaries, export, Compose, and lifecycle checks use the
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
- Next action: finish source-key verification if current official OpenAPI access becomes available,
  then complete remaining mapping/log-discard test coverage. The one-time athlete-data reset and explicit historical import remain
  pending; do not infer a historical range from `all` on an empty database.

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
