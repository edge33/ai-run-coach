# Code map

The workspace boundaries and domain rules are described in [implementation-plan.md](implementation-plan.md).
This guide locates the implementation within those boundaries.

## Database (`packages/db/src`)

- `index.ts` preserves the package's public exports.
- `store.ts` owns the SQLite connection, readiness checks, and cross-table counts. Its public methods
  delegate to repositories sharing the same Kysely connection.
- `schema.ts` defines persisted row types; `migrations.ts` owns versioned SQL and migration execution.
- `runs.ts` reads and writes runs and intervals together, preserving their transaction boundary.
- `health.ts` reads observations and transactionally replaces a day's measurements.
- `leases.ts` manages the atomic writer lease.
- `sync.ts` stores sync history, recovery state, issues, snapshots, and coverage.
- `ranges.ts` merges imported date ranges without accessing the database.

Keep repository queries near their related writes. Callers continue to use `Store`; repositories do
not create connections or import the Store facade.

## HTTP API (`apps/api/src`)

`app.ts` composes the server: logging, request restrictions, error handling, health/status endpoints,
route registration, and shutdown. Files under `routes/` register run, health, summary, and manual-sync
endpoints. `routes/schemas.ts` contains shared HTTP schema adapters and response envelopes.

`routes/sync.ts` owns progress-stream handlers. The application owns the active-stream cleanup set so
it can close connections before shutting down the sync manager. `manager.ts` retains worker lifecycle
management. Route modules receive dependencies explicitly and remain under the `/api` prefix.

## Core (`packages/core/src`)

`sync.ts` coordinates the manual ingestion workflow and its lease, progress, and failure handling.
`snapshots.ts` writes compressed source evidence atomically and records its metadata. `intervals.ts`
handles upstream requests, while `mapping.ts` validates and normalizes source records. Other domain
modules cover summaries, wiki operations, configuration, and backup/restore.

## Web (`apps/web/src`)

`App.tsx` composes navigation, status notices, and routes. `useSyncProgress.ts` manages the EventSource
subscription and query invalidation for an active manual sync, including cleanup on unmount.
`Runs.tsx` renders the run list; `RunDetails.tsx` renders an individual run and paginated intervals.
Overview, health, and synchronization retain their own screen modules. `components.tsx` contains shared
UI elements; `api.ts` contains API access and display helpers.

## Reviewing changes

Start with the relevant route or screen, then follow its Store or core call. For persistence changes,
review transaction boundaries and the schema together. Existing tests in each workspace exercise the
public interfaces, so internal module moves retain the same regression checks. Run the root scripts
`pnpm run check`, `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, and `pnpm run build` after a refactor.
