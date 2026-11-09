# Code map

The workspace boundaries and domain rules are described in [implementation-plan.md](implementation-plan.md).
This guide locates the implementation within those boundaries.

## Database (`packages/db/src`)

- `index.ts` preserves the package's public exports.
- `store.ts` owns the SQLite connection, readiness checks, and cross-table counts. Its public methods
  delegate to repositories sharing the same Kysely connection.
- `schema.ts` defines persisted row types; `migrations.ts` registers immutable modules under
  `migrations/`. Migration 002 removes unsupported run maximum power and interval elevation loss.
- `runs.ts` reads and writes runs and intervals together, preserving their transaction boundary.
- `health.ts` reads and upserts daily wellness rows.
- `leases.ts` manages the atomic writer lease.
- `sync.ts` stores sync history, recovery state, issues, and coverage.
- `ranges.ts` merges imported date ranges without accessing the database.

Keep repository queries near their related writes. Callers continue to use `Store`; repositories do
not create connections or import the Store facade.

## HTTP API (`apps/api/src`)

`app.ts` composes the server: logging, request restrictions, error handling, health/status endpoints,
route registration, and shutdown. Files under `routes/` register run, health, summary, and manual-sync
endpoints. `routes/schemas.ts` contains shared HTTP schema adapters and response envelopes.

`routes/sync.ts` awaits the importer directly inside `POST /api/sync-runs` and returns the final
sync record. Request disconnection and application shutdown cancel upstream requests and retry waits.
There is no sync manager, background job, or SSE endpoint. The SQLite writer lease excludes competing
imports, including the CLI. Route modules receive dependencies explicitly under the `/api` prefix.

## Core (`packages/core/src`)

`sync.ts` coordinates the manual ingestion workflow and its lease, counters, and failure handling.
`intervals.ts` handles bounded, cancellable upstream GET requests, while `mapping.ts` validates and
normalizes source records. Other domain modules cover summaries, wiki operations, configuration,
and normalized export. Source payloads, snapshots, and backups are not retained.

## Web (`apps/web/src`)

`App.tsx` renders the single page, start/end dates, range-sync button, validation, and sync feedback.
The latest 15 local dates are selected for sync by default, with a 90-day maximum. `Runs.tsx` and
`Health.tsx` always render all stored records, newest first, with independent 50-entry pages.
Their query keys contain only offsets; sync dates do not filter or reset the lists.
`api.ts` provides validated local API reads and `useSync`: click, await the result, refresh local
queries. `components.tsx` contains empty/error notices and bounded pagination. There are no
navigation routes, charts, summary cards, or detail screens.

## Reviewing changes

Start with the relevant route or screen, then follow its Store or core call. For persistence changes,
review transaction boundaries and the schema together. Existing tests in each workspace exercise the
public interfaces, so internal module moves retain the same regression checks. Run the root scripts
`pnpm run check`, `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, and `pnpm run build` after a refactor.
