# Running Data Hub progress

Last updated: 2026-09-23

## Current state

- Active branch: `chore/remove-e2e-tests`, created from freshly fetched `origin/main`
  (`54da789`). PR publication is authorized; no merge has been performed.
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

Validated this removal on 2026-09-23 with Node 24.21.0 and npm 11.19.0:

- `npm uninstall --package-lock-only --ignore-scripts --offline @playwright/test` passed;
  the lockfile removes only Playwright packages and the root dependency.
- `npm run check`, `npm run typecheck`, and `npm run lint` passed.
- Initial sandbox `npm test` failed when the MCP stdio subprocess closed its connection;
  Turbo then interrupted web tests. `npm test` outside the sandbox passed all 17 tests
  (database 3, core 7, API 1 reused from that first run; MCP 3 and web 3 ran again).
- `npm run build` passed the frontend production build.
- `git diff --check` passed. Compose checks were not rerun for this tooling-only removal.

## Previous main-branch Docker validation (not rerun for this removal)

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
- Next recommended action: review the removal PR and its CI results; local validation passed.

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
3000, and HTTP MCP on 3001. `npm run build` produces only the frontend assets. `npm run mcp` starts the stdio transport. The Synchronization view or
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
