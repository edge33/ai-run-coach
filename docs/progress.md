# Running Data Hub progress

Last updated: 2026-09-23

## Current state

- Active branch: `feature/running-data-hub`.
- The application and handoff documents are delivered together in the feature commit following the
  empty baseline `81f550c`. Use `git log -1 --oneline` for the current checkpoint.
- Pushed to `origin/feature/running-data-hub`; pull request
  [#1](https://github.com/edge33/ai-run-coach/pull/1) targets `main`. No merge has been performed.

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
  integration, protocol, browser, and Compose smoke tests.

## Validation results

- `npm run check`, `npm run build`, `npm run typecheck`, and `npm run lint` all passed.
- Core tests passed: date/DST behavior, idempotent imports, edits, partial failures, missing-versus-zero
  summaries, retries, wiki confirmation, and backup/restore.
- API tests passed after correcting host normalization and range parsing.
- `npm test` passed all 17 tests: database 3, core 7, API 1, MCP 3, and web 3.
- MCP in-memory, Streamable HTTP, and native TypeScript stdio tests passed.
- `npm run test:e2e` passed its Playwright dashboard test, including manual sync progress,
  deduplication, failure preservation, sparse data, and responsive layout.
- Docker Engine 29.8.1 and Docker Compose 5.5.1 are now available and reachable.

The suite was rerun on 2026-09-22 with host subprocess/browser access. The earlier stdio connection
failure occurred only inside the restricted sandbox; no application fix was needed. A Biome warning
was resolved by declaring `SMOKE_ORIGIN` in Turbo's environment configuration.

## Docker validation

- Compose configuration, runtime/proxy image builds, migrations, and service health passed.
- `nginx -t` and `scripts/compose-smoke.mjs` passed: SPA deep links, missing-asset/API 404s,
  MCP initialization/list/call, and rejected untrusted origins through the proxy.
- `scripts/compose-lifecycle.mjs` passed SSE progress/heartbeat streaming, SQLite and file persistence
  across forced API/MCP/Nginx recreation, shared database visibility, SQLite integrity, and exactly
  one published port (`127.0.0.1:8080`). Non-root container wiki writes and coordinated backup/restore
  also passed, including restored SQLite integrity, usable leases, snapshots, and wiki files.
- Container validation exposed and fixed a wiki-lock permissions issue: the lock now lives inside
  the shared wiki volume and is excluded from backup archives. Build, typecheck, Biome/lint, affected
  core/API/MCP tests, rebuilt containers, lifecycle tests, and proxy smoke checks passed afterward.
  The backup regression test also verifies that a restored wiki can be updated immediately.
- CI now includes the lifecycle script and uses the isolated validation project name.
- Docker used its classic builder because the Buildx CLI plugin is absent; the build succeeded.
- The disposable validation stack and synthetic-data volumes are removed with the teardown command
  below. No production data was created or modified.

## Environment-dependent follow-up

- No live Intervals.icu credentials were supplied. Ingestion was validated with synthetic upstream
  responses; a real athlete import remains a deployment smoke check initiated by the user.
- Tailscale exposure was validated with loopback substituted for the address. Access from another
  tailnet device remains a deployment check after configuring the real address and matching origin.
- No production deployment or merge has been performed.

## Resume commands

Use Node 24.21.0 and npm 11.19.0. On a fresh checkout run `npm ci` and
`npx playwright install --with-deps chromium` first. Run from the repository root:

```bash
git status --short
docker version
docker compose version

npm run check
npm run build
npm run typecheck
npm run lint
npm test
npm run test:e2e

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
Docker daemon access and the Playwright browser installation must be available. In restricted agent
environments, Docker and subprocess/browser tests may require execution outside the sandbox.

## Local operation

Copy `.env.example` to `.env`, configure local paths/origins and optional Intervals credentials, then
run `npm run build`, `npm run migrate`, and `npm run dev`. The web app runs on port 5173, the API on
3000, and HTTP MCP on 3001. `npm run mcp` starts the stdio transport. The Synchronization view or
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
