# Running Data Hub progress

Last updated: 2026-09-27

## Minimal data model implementation

- Approved plan and phase checklist: [minimal-data-model-plan.md](minimal-data-model-plan.md).
  This supersedes the older snapshot, backup/restore, and data-model requirements in the original
  architecture document. Use the tracker for phase status, acceptance checks, and execution evidence.
- Decisions: fresh SQLite database with Kysely; minimal wellness/run/interval records; no snapshots,
  backups, or legacy-data migration. Preserve configuration, credentials, and the athlete wiki.
- Phase 1 is complete on `feature/minimal-data-model`, based on fetched `origin/main` at
  `9b3aeb5`. The clean initial migration defines wellness, runs, run intervals, and operational
  tables; shared contracts and database repositories use the new fields. The existing worktree
  planning-document edits were preserved. No athlete database, reset, or import was touched.
- `npm run check:fix`, `npm run test -w @hub/db` (3 passed), `npm run typecheck -w @hub/db`,
  `npm run check`, and `git diff --check` passed. The database tests cover fresh and repeated
  migration, FK and measurement constraints, upserts, lease exclusion, and interval rollback.
- `npm run typecheck` fails in `@hub/core`: mapping, sync, summaries, backup, and old tests still
  use removed schema fields and methods. This is the expected phase 2–4 integration gap. Full
  tests and build were not run. The application should not be run against a fresh database until
  those phases are complete.
- Draft [PR #5](https://github.com/edge33/ai-run-coach/pull/5) is open against `main`. Both
  application CI jobs failed at `npm run typecheck` with the same old-schema references. Keep
  the PR in draft while completing the dependent phases.
- Documentation validation: `git diff --check` passed. A Python check verified 34 pending checklist
  items, linked document existence, and no trailing whitespace in the new tracker. The first check
  incorrectly expected 32 items; correcting that assertion to the actual 34 passed. Application
  tests were not run for this documentation-only change.
- Next recommended action: implement phase 2 ingestion and synchronization, verifying upstream
  mappings before completion; then update API, MCP, web, and operational consumers. Record a manual
  historical import range before the final import.

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

- Turborepo/npm workspace, pinned Node and dependencies, shared TypeScript config, and Biome config.
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

Use Node 24.21.0 and npm 11.19.0. On a fresh checkout run `npm ci` first.
Run from the repository root:

```bash
git status --short
docker version
docker compose version

npm run check
npm run build
npm run typecheck
npm run lint
npm test

export TAILSCALE_IP=127.0.0.1 APP_ORIGINS=http://127.0.0.1:8080 INTERVALS_API_KEY=''
docker compose -p running-data-hub-validation config --quiet
docker compose -p running-data-hub-validation up --build -d --wait
docker compose -p running-data-hub-validation exec nginx nginx -t
SMOKE_ORIGIN=http://127.0.0.1:8080 node scripts/compose-smoke.mjs
node scripts/compose-lifecycle.mjs
docker compose -p running-data-hub-validation ps
docker compose -p running-data-hub-validation logs
docker compose -p running-data-hub-validation down -v
```

Use `127.0.0.1` only for local validation. Homelab deployment must set `TAILSCALE_IP` to the host’s
actual Tailscale address and set `APP_ORIGINS` to the matching externally used origin.
The lifecycle script requires fresh disposable validation volumes and seeds synthetic fixtures.
The final `down -v` deletes only that validation project's volumes; never use it against athlete data.
Docker daemon access must be available. In restricted agent environments, Docker and subprocess
tests may require execution outside the sandbox.

## Local operation

Copy `.env.example` to `.env`, configure local paths/origins and optional Intervals credentials, then
run `npm run migrate` and `npm run dev` (no build prerequisite). The web app runs on port 5173, the API on
3000, and HTTP MCP on 3001. `npm run build` produces only the frontend assets. `npm run mcp` starts the stdio transport. On this workstation, Codex starts it through the
registered `running_data_hub` MCP server; a new Codex session is needed after registration.
The Synchronization view or
`npm run sync` explicitly starts an import; service startup does not.

`npm run backup -- DESTINATION` creates a coordinated backup in a new empty directory.
`npm run restore -- BACKUP_DIR EMPTY_DESTINATION` verifies and restores it. Point `SQLITE_PATH`,
`SNAPSHOT_PATH`, and `WIKI_PATH` to the restored `coach.sqlite`, `snapshots`, and `wiki` respectively.
For Compose backups, run a helper with all three volumes mounted: API alone has no wiki mount.
The lifecycle script demonstrates that helper and verifies restoration without touching host data.

## Update discipline

Every agent that changes implementation state, validation results, blockers, or the recommended next
action must update this file in the same change. Replace stale claims instead of appending ambiguous
status notes. Include the command, result, and any environment-dependent limitation.
