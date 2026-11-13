# Architecture

The hub stores completed running activities and daily wellness in SQLite. Garmin API JSON
supplies summaries; original FIT files supply laps, splits and samples. The web UI and MCP read
that shared database. A Markdown wiki stores athlete context, with provenance and confirmation
for conflicting or inferred facts. [Measurement rules](run-analysis-data.md) explain the values.

## Project layout

| Location             | Purpose                                                    |
| -------------------- | ---------------------------------------------------------- |
| `apps/web`           | React/Vite UI: manual Sync and paginated run/health lists  |
| `apps/api`           | Fastify API: local reads and cancellable imports           |
| `apps/mcp`           | Local tools over stdio or Streamable HTTP; no sync tool    |
| `packages/contracts` | Shared schemas, units and request limits                   |
| `packages/core`      | Garmin extraction, imports, summaries, wiki and export     |
| `packages/db`        | SQLite schema and repositories using Kysely/better-sqlite3 |
| `deploy`             | Container startup, health check and Nginx configuration    |

Training periods, plans, readiness and coaching interpretation belong to connected agents.
The server stores measured data and calculates summaries on demand; it has no training-load model.

## Imports

Only a web UI Sync request starts an import. Dates must be explicit, nonfuture and at most 90
inclusive days. Each import fetches the selected range again; reads and startup never sync.

Requests are sequential, with no automatic retries. Wellness requests use windows of at most 31
days; activity search paginates to an empty page. The network deadline is ten minutes, each
request is limited to 60 seconds, and response/file/sample sizes are bounded. Request starts are
paced by `GARMIN_REQUEST_INTERVAL_MS` (default 1000; range 0–60000), including authentication and
downloads. This pacing is not a guarantee against Garmin rate limits.

A writer lease prevents overlapping imports. Data is validated in disposable SQLite staging,
then records, coverage and completion history are published in one transaction. Failure or
cancellation publishes nothing and leaves previous measurements intact. Disconnecting the client
or stopping the server cancels the import. The next writer recovers abandoned history.
Absence from an upstream response never deletes an existing run.

Named Zod contracts validate consumed Garmin fields. Breaking changes return
`GARMIN_CONTRACT_CHANGED`; unused additive fields are ignored. Review source evidence before
changing a contract. Optional-field removal cannot always be distinguished from missing data.

On HTTP 429, the import stops. A usable `Retry-After` disables Sync until the supplied deadline;
the API also rejects early retries. No hint means no invented cooldown. Cooldown is held in
memory and clears on restart. Expiry never starts another import automatically.

## Runtime and operations

One image runs Nginx, API and MCP, exposing only port 8080. API/MCP listen on loopback internally.
Tini and a startup wrapper handle child exits and shutdown. The wrapper initializes SQLite first;
this creates missing tables/indexes, preserves current data and rejects an incompatible schema.
It is not a migration runner. Native development runs `pnpm run db:init` explicitly.

The image health check probes all three services locally. Unexpected service exit stops the
container; health status alone does not trigger Docker's restart policy. Shutdown has a
25-second deadline inside Compose's 30-second grace. See [deployment](storage.md).

Logs go to stderr. `LOG_LEVEL=info` shows import progress and failures; `debug` adds request
summaries. Events share a `sync_id` and safe counts/status/timing. Staged counts are not published
counts. Logs exclude credentials, athlete measurements and upstream bodies. The proxy timeout
is 300 seconds, so a long synchronous import can outlast the proxy connection.

[Release automation](releases.md) publishes tagged images; it does not deploy them or import data.
There is a core export function, but no general import/export CLI or built-in backup system.
