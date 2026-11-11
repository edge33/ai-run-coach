# Running Data Hub implementation plan

> The minimal model in [the implementation tracker](minimal-data-model-plan.md) supersedes the
> original data model, snapshot, backup/restore, and migration requirements below. The code now
> uses that model; operational reset and historical import remain separate deployment steps.

The approved [run analysis extension](run-analysis-data.md) adds normalized sample streams and exact
interval boundaries. It supersedes the earlier summary-only ingestion scope.

## Purpose

Build a personal running-data hub that manually imports completed runs and health data from
Intervals.icu, stores normalized and auditable records in SQLite, displays them in a React dashboard,
and exposes them with athlete context through MCP. The application does not model training periods,
generate plans, or write calendar events; MCP-connected agents own those outcomes.

The application must remain useful with zero, one, or two days of data. Missing history and missing
measurements must be reported rather than inferred.

## Architecture

Use a Turborepo with pnpm workspaces and pinned dependencies:

```text
apps/
  web/          Vite, React, TanStack Query
  api/          Fastify HTTP API and request-bound manual sync
  mcp/          Shared MCP tools over stdio and Streamable HTTP
packages/
  contracts/    Browser-safe Zod schemas and shared types
  core/         Intervals client, ingestion, summaries, wiki, normalized export
  db/           Kysely repositories, SQLite migrations, leases
  config/       Shared TypeScript configuration
athlete_wiki/   Local Markdown knowledge, excluded from Git
data/           SQLite, excluded from Git
```

Run API, MCP, and shared-library TypeScript directly on Node 26.13.0 using erasable syntax.
Private workspace packages export their `.ts` sources; only Vite builds the browser app. Use Biome
across all code workspaces and keep TypeScript checking as a separate gate.

## Data and synchronization

Use SQLite with `better-sqlite3` and Kysely. Enable foreign keys, WAL, and a busy timeout. Mount the
whole database directory so SQLite sidecar files stay with the database. API and MCP processes share
the same database, while an atomic lease prevents concurrent synchronization writers.

Persist:

- completed road, trail, treadmill, and virtual running activities;
- source-provided intervals in upstream order;
- aligned time, distance, speed, HR, power, altitude, and cadence samples, with distinct raw/corrected
  streams and exact interval boundaries;
- daily wellness rows with the approved measurements and units;
- minimal sync runs, issues, coverage, and writer leases.

Do not persist unsupported run maximum power or interval elevation loss. Keep run elevation loss
and interval average/maximum power when provided. Migration `002_remove_unsupported_measurements`
drops only the unsupported columns from existing databases; apply migrations before updated services
start. Migration `003_run_samples` adds sample storage, interval timing, and minimal power provenance.
The initial migrations remain immutable; existing runs need a manual re-sync to populate new fields.

Do not persist training periods, calendar events, readiness scores, coaching proposals, or generated
plans. Calculate only simple deterministic summaries on demand: run totals, aggregate pace from
qualifying distance/time pairs, and count/minimum/maximum/mean for a single health metric. Always
return units, date bounds, sample counts, missingness, provenance, and synchronization coverage.

Imports are exclusively user-triggered through the web UI and its HTTP API, for an explicitly
selected range of at most 90 inclusive local dates. Each import fetches the full approved dataset
for those dates again; it does not skip previously imported records or derive dates from history.
There is no general CLI. Compose runs a dedicated migration bootstrap before services start.
Normalized export remains a core library capability.

Use bounded 90-day request windows and end-to-end timeouts. Imports stop on the first failed request
without automatic retry, including rate limits and server errors, per the approved all-or-nothing policy.
Keep rate-limit observations, runtime response validation, and transactional upserts. Retain only the
approved normalized fields. Stage normalized records in disposable SQLite during downloads, then publish
all runs, intervals, samples, wellness, coverage, and the completed sync record in one transaction.
Any request, validation, or persistence failure aborts the entire batch, including earlier windows.
Cancellation and lease loss discard the batch too. Keep failure history/issue metadata while preserving
the last committed data and coverage timestamps. Absence from an incomplete response never proves
deletion. Opening the app, reading local APIs, querying MCP, and restarting
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

The Vite React app is a single plain page with start/end date pickers, a Sync button, a run list,
and a daily health list. Default sync to the latest 15 local dates, including today. The selection controls
explicit range sync only. Both lists always browse all stored records, newest first, independently
paginated with at most 50 entries per page. Label the maximum as three months (90 inclusive days);
block invalid, reversed, future, or oversized selections and enforce the same range limit in core
before acquiring a lease or contacting upstream. Disable date controls while syncing. Changing
sync dates leaves both lists and their pagination unchanged; importing requires clicking Sync.

Runs display distance, moving time, and average heart rate; health rows display resting heart rate,
HRV, sleep, and weight. Missing measurements remain explicit. Navigation, charts, summaries, run
details, and sync-history screens are removed. The button waits for the import outcome, then
refreshes both lists. Web/API range imports share the 90-day cap; historical imports can be
split into explicit ranges.
Disable polling and automatic focus/reconnect refetches. Clearly distinguish loading, empty,
missing, and failed states, and show aborted imports with zero saved records.

Overlapping imports upsert runs by activity ID and health by date, updating existing measurements
without duplicates. Valid run details replace intervals transactionally; failed detail requests
preserve the stored run and intervals. Missing upstream records are not automatically deleted.
Only one sync writer is allowed at a time, including requests for different ranges.
The form is disabled only while its own import request is pending; cached status never permanently
locks Sync. The server enforces concurrency with the writer lease and returns 409 for genuine overlaps.
An active sync must own an unexpired writer lease. Abandoned history is marked interrupted when the
next import acquires the lease; reading status never contacts upstream or starts recovery imports.

Fastify provides bounded, schema-validated endpoints for runs, run details, health observations,
summaries, data status, and manual sync/history/details. Run and health list endpoints accept
optional paired start/end dates; omitting both returns all stored records with pagination and a
maximum page size of 50. Existing date-filtered reads remain supported. `POST /api/sync-runs` executes the import
inside the request and returns `200` with its final completed, failed, or interrupted sync record.
Historical partial records remain readable. There are no background import tasks or progress streams. A competing request
returns `409` with the active sync. Client disconnection or API shutdown cancels upstream requests
and retry waits, records interruption, and releases the writer lease. Keep credentials server-side,
redact logs, validate host/origin headers, and bound bodies, ranges, pages, and responses.

## Deployment

Build one multi-stage Dockerfile with a non-root Node runtime target for API/MCP/migrations and an
Nginx target containing the production Vite assets. Docker Compose runs one-shot migrations, API,
MCP, and Nginx with named volumes for the database and wiki.

Only Nginx publishes `${TAILSCALE_IP}:8080`. API and MCP stay on the internal Compose network. Nginx
serves the SPA, proxies `/api` and `/mcp`, preserves protocol headers, and disables buffering for MCP
streams. Deployment assumes the host already participates in Tailscale. Authentication is outside v1; host/origin validation and request limits remain enabled.

Retain normalized JSON export through the core library function. The general CLI is removed;
Compose invokes a dedicated migration bootstrap. The one-time fresh start deletes only this application's
legacy database and data archives after writers stop; credentials, configuration, and wiki persist.

## Acceptance

- Biome, build, typecheck, unit/integration tests, and MCP protocol tests pass.
- Repeated syncs are idempotent, edits are captured, failures preserve prior data, and reads never sync.
- Stdio and HTTP MCP expose equivalent bounded tools without protocol contamination.
- Compose builds and starts; migrations complete; API/MCP/Nginx health checks pass.
- Nginx serves SPA deep links, preserves API errors, proxies MCP, and returns manual import outcomes.
- SQLite and wiki survive application-container recreation; only Nginx publishes a port.
- Normalized export contains only the approved records and operational metadata.
