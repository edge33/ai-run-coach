# Running Data Hub implementation plan

> The minimal model in [the implementation tracker](minimal-data-model-plan.md) supersedes the
> original data model, snapshot, backup/restore, and migration requirements below. The code now
> uses that model; operational reset and historical import remain separate deployment steps.

## Purpose

Build a personal running-data hub that manually imports completed runs and health data from
Intervals.icu, stores normalized and auditable records in SQLite, displays them in a React dashboard,
and exposes them with athlete context through MCP. The application does not model training periods,
generate plans, or write calendar events; MCP-connected agents own those outcomes.

The application must remain useful with zero, one, or two days of data. Missing history and missing
measurements must be reported rather than inferred.

## Architecture

Use a Turborepo with npm workspaces and pinned dependencies:

```text
apps/
  web/          Vite, React, React Router, TanStack Query
  api/          Fastify HTTP API and manual sync worker
  mcp/          Shared MCP tools over stdio and Streamable HTTP
packages/
  contracts/    Browser-safe Zod schemas and shared types
  core/         Intervals client, ingestion, summaries, wiki, normalized export
  db/           Kysely repositories, SQLite migrations, leases
  config/       Shared TypeScript configuration
athlete_wiki/   Local Markdown knowledge, excluded from Git
data/           SQLite, excluded from Git
```

Run API, MCP, and shared-library TypeScript directly on Node 24.21.0 using erasable syntax.
Private workspace packages export their `.ts` sources; only Vite builds the browser app. Use Biome
across all code workspaces and keep TypeScript checking as a separate gate.

## Data and synchronization

Use SQLite with `better-sqlite3` and Kysely. Enable foreign keys, WAL, and a busy timeout. Mount the
whole database directory so SQLite sidecar files stay with the database. API and MCP processes share
the same database, while an atomic lease prevents concurrent synchronization writers.

Persist:

- completed road, trail, treadmill, and virtual running activities;
- source-provided intervals in upstream order;
- daily wellness rows with the approved measurements and units;
- minimal sync runs, issues, coverage, and writer leases.

Do not persist training periods, calendar events, readiness scores, coaching proposals, or generated
plans. Calculate only simple deterministic summaries on demand: run totals, aggregate pace from
qualifying distance/time pairs, and count/minimum/maximum/mean for a single health metric. Always
return units, date bounds, sample counts, missingness, provenance, and synchronization coverage.

Synchronization is exclusively user-triggered:

- recent: refresh the last 14 local dates;
- range: refresh an explicitly selected date range;
- all: reconcile all previously imported ranges.

Use bounded 90-day request windows, end-to-end timeouts, bounded retry/backoff with `Retry-After`,
rate-limit observations, runtime response validation, and transactional upserts. Retain only the
approved normalized fields. Preserve the last valid records on partial or failed imports. Absence from an incomplete
response never proves deletion. Opening the app, reading local APIs, querying MCP, and restarting
containers must not contact Intervals.icu.

## Athlete wiki and MCP

Keep athlete background, experience, goals, availability, preferences, established zones, and
limitations in a local Markdown wiki with validated YAML metadata, provenance, revisions, atomic
writes, and cross-process locking. SQLite remains authoritative for measured data; the wiki remains
authoritative for athlete context and settings.

Save explicit nonconflicting user facts automatically. Conflicting changes and inferred facts require
an immutable pending proposal and explicit confirmation. Treat imported descriptions and wiki prose
as untrusted data rather than instructions.

Expose bounded MCP tools for run/health retrieval, summaries, freshness, athlete context, and scoped
wiki reads and updates. Use one tool registry for stdio and stateless Streamable HTTP at `/mcp`.
Never expose arbitrary SQL, upstream HTTP, filesystem access, or synchronization tools. Agents must
check freshness, cite dates/units/evidence, report uncertainty, and ask the user to synchronize when
new evidence is required.

## Web application and API

The Vite React app contains Overview, Runs, Health, and Synchronization views. It uses local API reads,
explicit query refresh, and SSE only for an active manual sync. Disable polling and automatic
focus/reconnect refetches. Clearly distinguish loading, empty, missing, incomplete, and failed states.

Fastify provides bounded, schema-validated endpoints for runs, run details, health observations,
summaries, data status, sync creation/history/details, and SSE progress. Starting a sync returns `202`
and a run ID. A competing request returns the active sync. Keep credentials server-side, redact logs,
validate host/origin headers, and bound bodies, ranges, pages, and responses.

## Deployment

Build one multi-stage Dockerfile with a non-root Node runtime target for API/MCP/migrations and an
Nginx target containing the production Vite assets. Docker Compose runs one-shot migrations, API,
MCP, and Nginx with named volumes for the database and wiki.

Only Nginx publishes `${TAILSCALE_IP}:8080`. API and MCP stay on the internal Compose network. Nginx
serves the SPA, proxies `/api` and `/mcp`, preserves protocol headers, and disables buffering for SSE
and MCP streams. Deployment assumes the host already participates in Tailscale. Authentication is
outside v1; host/origin validation and request limits remain enabled.

Provide a normalized JSON export command. The one-time fresh start deletes only this application's
legacy database and data archives after writers stop; credentials, configuration, and wiki persist.

## Acceptance

- Biome, build, typecheck, unit/integration tests, and MCP protocol tests pass.
- Repeated syncs are idempotent, edits are captured, failures preserve prior data, and reads never sync.
- Stdio and HTTP MCP expose equivalent bounded tools without protocol contamination.
- Compose builds and starts; migrations complete; API/MCP/Nginx health checks pass.
- Nginx serves SPA deep links, preserves API errors, proxies MCP, and streams progress.
- SQLite and wiki survive application-container recreation; only Nginx publishes a port.
- Normalized export contains only the approved records and operational metadata.
