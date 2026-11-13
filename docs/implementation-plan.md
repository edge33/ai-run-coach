# Garmin-only running data hub

The hub manually imports completed running activities and daily wellness from Garmin Connect's
Personal API into SQLite. The [Garmin tracker](garmin-migration-plan.md) records implementation
and deployment status; [measurement semantics](run-analysis-data.md) define stored records.

## Architecture

- `apps/web`: Vite/React single-page date selection, manual Sync, and paginated run/health lists.
- `apps/api`: Fastify local reads and a request-bound, cancellable manual import.
- `apps/mcp`: bounded local tools over stdio and Streamable HTTP; never initiates synchronization.
- `packages/contracts`: browser-safe Zod schemas and explicit measurement units.
- `packages/core`: Garmin JSON/FIT extraction, atomic import orchestration, summaries, wiki, export.
- `packages/db`: Kysely repositories over `better-sqlite3`, schema initialization, leases and coverage.

Use the pinned Node/pnpm versions, existing workspaces and Biome. SQLite uses foreign keys, WAL,
STRICT measurement tables and a busy timeout. Credentials, databases, private probe reports and
athlete wiki content stay out of Git and Docker image layers.

## Source and synchronization

Run summaries and daily wellness come from API JSON. Recorded laps, workout-classified splits,
and samples come from original activity FIT files decoded with Garmin's official SDK. Recorded
laps and splits are separate datasets; overlapping split categories are never added together.
Keep only FIT splits whose source type starts with `interval`; preserve the original split sequence
and type spelling. Planned workout instructions and API aggregate split summaries remain exploratory
information and are not persisted in the measured-data model.

Import only road, trail, track, treadmill/indoor and virtual running types supported by the mapper.
Other activities may be listed during extraction but are not stored as runs. Multi-session original
files are rejected until an explicit session-selection policy exists. Virtual running does not imply
indoor. Use source-local run dates without inventing timezone offsets.

Imports require explicit start/end dates, no future dates, and at most 90 inclusive local dates.
Every import retrieves all approved data for those dates again. Split resource windows into at most
31 days; paginate activities to an empty page. Use sequential bounded requests, a ten-minute network
deadline, 60-second request timeouts, bounded response/file/sample sizes and no automatic retries.
Garmin request starts are spaced at least `GARMIN_REQUEST_INTERVAL_MS` apart (default 1000 ms,
configurable from 0 to 60000). This is conservative application pacing, not Garmin's published
quota. Pacing includes authentication and downloads, supports cancellation, and shares a gate
across manual imports in one API instance.
Exchange the server-side Garmin key for a short-lived access token during the import only.

Every JSON request requires a named Zod response contract in `garmin/schemas.ts`: token,
activity search, activity detail, daily summary, sleep/HRV range responses and weight (plus
single-day sleep/HRV and workouts in the
separate development probe). Required envelope/core fields must be present, even when a
measurement is explicitly null. Range sleep/HRV measurements require valid source dates, reject
duplicates and out-of-range dates, and join by date rather than array position. Empty undated sleep
rows (zero/null sleep duration) are ignored without assigning dates; undated positive sleep remains
an error, and dated zero readings are preserved. Missing dates yield null
measurements; no neighboring-day values are carried forward. Single-day sleep dates remain optional
in the development probe, where the request identifies the day; range imports never invent dates. Changed field types, renamed required fields and invalid dates
raise `GARMIN_CONTRACT_CHANGED`. Optional device-dependent readings may be omitted. Additional
upstream fields are ignored and stripped; this validates the consumed contract rather than
claiming to detect every possible Garmin API change. Missing optional values cannot be
unambiguously distinguished from a removed optional field.

Contract failures abort the batch with zero published records and unchanged prior measurements
and coverage. History retains the sanitized code; the UI shows it after the request and on reload.
Logs contain only the contract name and up to ten field paths/issue codes plus expected/received
type names, never upstream values,
response bodies, credentials or validation error dumps. Correct the schema only after reviewing
source evidence, then retry manually from the UI.

Normalize into disposable private SQLite staging. Publish runs, laps, splits, samples, wellness,
coverage and completion history in one transaction after all resources validate. Any request,
validation, persistence, cancellation or lease failure aborts the entire batch; previous data and
coverage remain unchanged. Preserve sanitized failed/interrupted history. Unknown/missing measurements
remain null; measured zero remains zero. Absence from an upstream response never deletes stored runs.

A single expiring writer lease prevents competing imports. Client disconnection/shutdown cancels
requests and releases the lease; the next writer recovers abandoned history. No startup, API read,
MCP read, polling, focus/reconnect event or schema initializer contacts Garmin.

## Wellness request selection

For each at-most-31-day window, retrieve sleep via
`/sleep-service/sleep/dailySleepSummariesByDate`, HRV via
`/hrv-service/hrv/daily/{fromDate}/{toDate}`, and weight via its existing range endpoint.
Retrieve daily summaries via `/usersummary-service/v2/dailysummaries` once per window and map
`data[].heartRate.restingValue` to `resting_hr_bpm`. The user explicitly accepts Garmin's fallback
to minimum HR when resting HR is unavailable. The field name remains unchanged; UI, MCP tool
wording and metric definitions explain the fallback. We cannot distinguish which rows use it.
Missing days/heartRate groups/readings stay null, and zero is preserved. Never independently
substitute `minValue` or call the per-day endpoint to fill gaps.
For September 1–November 12 (73 dates), daily-summary/sleep/HRV calls now total 9:
3 daily-summary calls, 3 sleep calls and 3 HRV calls. Weight, activities and authentication are additional.

## Local consumers

Application imports are started from the web UI only; there is no application import CLI.
The web selection defaults to the latest 15 dates; importing requires clicking Sync. Lists browse
all stored records independently, newest first, in pages of at most 50. Loading, empty, missing,
failed and interrupted states remain explicit. Date selection does not filter the lists.

HTTP run detail and MCP `get_run` return independently paginated `laps` and `splits`, each capped
at 100. Sample pages are capped at 100 and include their import timestamp. Restart pagination if a
new import changes that timestamp. All pages use consistent read transactions. Removed load metrics
are invalid inputs. Agents must respect timing warnings, missingness, coverage and latest sync status.

Run/lap/split summaries are stored measurements. Cross-run totals, aggregate pace and health
min/max/mean are calculated from local measurements on demand. No CTL/ATL/form, training-load model,
readiness score, planned workouts or coaching interpretation is stored. Athlete context remains in
the private Markdown wiki, with provenance and explicit confirmation for conflicting/inferred facts.

On HTTP 429, the batch aborts with zero published measurements. If Garmin supplies a usable
`Retry-After`, `/api/status` returns `cooldown_until`, the UI disables Sync until that time,
and the API rejects early POST attempts with HTTP 429, `GARMIN_RATE_LIMITED`, `cooldown_until`
and a Retry-After header before starting another import or contacting upstream. The UI unlocks
locally without automatically importing. With no usable hint, no cooldown duration is invented.
Cooldown state is held in the API instance and clears on process restart; it is not a persisted
or cross-process account-wide quota. Pacing and cooldown reads never initiate synchronization.

## Initialization and deployment

There is one current Garmin schema, no migration chain and no legacy conversion path.
`pnpm run db:init` runs `scripts/initialize.ts` to create empty tables idempotently. It does not
reset or delete existing data. Initialization rejects an incompatible existing run schema.
API/MCP startup checks schema readiness and never initializes or imports implicitly.

Compose runs the one-shot `initialize` service before API/MCP. Only Nginx publishes
`${BIND_IP:-127.0.0.1}:8080`, serving the web app and proxying `/api` and `/mcp`. Configure
`APP_ORIGINS` to the externally used origin. API receives `GARMIN_API_KEY`; MCP needs no upstream key.
Database and wiki use separate volumes. Keep existing host/origin validation and response limits.

For native operation: configure ignored `.env`, run `pnpm run db:init`, then `pnpm run dev`.
The normalized `exportData` core function emits source/mapping metadata and measured records.
There is no general import/export CLI or backup system. The standalone Garmin explorer is a
separate development aid and writes only ignored private reports.

## Import logging

Server logs go to stderr using Pino. Default `LOG_LEVEL=info` reports import start, activity-list
completion, staged resource windows, completion, and every failed/interrupted import. Each import
uses a shared `sync_id`; summaries include request/record/window counts and elapsed milliseconds.
Staged counts are not published counts. A failed import logs `upserted: 0` and its sanitized code.

Upstream request failures log a safe endpoint label (for example `sleep`), method, request number,
HTTP status when available, duration, parsed `retry_after_s`, and numeric rate-limit headers when
provided. Missing/unusable headers appear as null. HTTP 429 is explicitly logged as a rate-limit
warning, followed by the import failure summary. Imports stop without automatic retries.

Set `LOG_LEVEL=debug` in the ignored root `.env` and restart services for every request start and
successful HTTP response summary (status, bytes, duration). Compose forwards the configured level.
No URLs/query strings, activity IDs, athlete dates, measurements, keys, tokens, response bodies,
arbitrary header values or original network-error messages are logged by these import events.
