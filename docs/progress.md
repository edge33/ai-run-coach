# Running Data Hub progress

Last updated: 2026-11-13

## CI bind-mount startup fix (current)

- PR #16 CI run `43449414709` failed during `docker compose up --build -d --wait`:
  initializer logged `EACCES: permission denied, mkdir '/app/data/db'`. The missing host bind
  directory was created by Docker as root, hiding image-layer ownership. Initial bind config
  validation did not exercise this fresh-checkout startup requirement.
- CI now sets `DATA_PATH=${{ runner.temp }}/running-data-hub-validation-data` in the setup
  step, exports it through `GITHUB_ENV` for later steps, and prepares it
  before Compose with `sudo install -d -m 0755 -o 1000 -g 1000 "$DATA_PATH"`. All Compose steps
  share this path. Storage docs explain host ownership and the root-created-directory failure.
  Application logic, image runtime identity and user data are unchanged.
- Local disposable full-stack validation passes with
  `DATA_PATH=/tmp/ai-run-coach-bind-ci.oaLZYM APP_ORIGINS=http://127.0.0.1:8080
  BIND_IP=127.0.0.1 GARMIN_API_KEY='' DOCKER_BUILDKIT=0 docker compose --env-file /dev/null
  -p running-data-hub-bind-ci-validation up --build -d --wait`. Directory prepared as UID/GID
  1000:1000; classic builder used because local Buildx is unavailable. Initializer exits 0;
  API, MCP and Nginx all healthy. `exec nginx nginx -t` passes, and proxy `/api/status` confirms
  zero runs/health dates, empty coverage and no history. An initial ad hoc status assertion used
  nonexistent `source_configured`; corrected to actual status fields, with no application change.
- `pnpm run check` (75 files) and `git diff --check` pass. No new tests for CI/deployment wiring
  per repository rules; prior 79 application tests still apply. Removed disposable containers,
  network and bind directory after verification. No real data/imports involved.
- First fix push `0b14b9f` had no jobs: `runner.temp` was placed in job-level env, where the
  runner context is unavailable. Moved it to step env and persisted the path via `GITHUB_ENV`.
- Worktree `/home/edge33/dev/ai-run-coach`, branch `chore/data-directory-cleanup`. Next: verify
  GitHub CI on existing PR #16 and review/merge before single-container work.

## Cleanup and storage PR handoff (current)

- User authorized committing/pushing `chore/data-directory-cleanup` and opening a PR against
  `main`. Refetched `origin/main`; it remains `2ad68a3`, the branch base. Scope is temporary
  Garmin exploration removal, persistent database/wiki paths under `data/`, Compose host bind
  mounts and storage documentation. Single-container packaging is deferred to a new change
  from fresh main after this work is merged; no process supervision/startup change is included.
- Prior full validation remains applicable: 79 uncached synthetic tests, typecheck, lint, build,
  runtime image build and disposable database/wiki persistence smoke passed. Bind-mount follow-up
  passed default/override Compose config inspection. Final `pnpm run check` and `git diff --check`
  pass. Reviewed candidate diff; ignored credentials, database, wiki and personal configuration
  remain excluded. Local test measurements/history were separately cleared with user authorization.
- Worktree `/home/edge33/dev/ai-run-coach`. Publication includes the cleanup/storage source,
  tests and documentation only. No image publication, deployment, merge or Garmin import is
  authorized by this PR handoff. Next: review/merge the PR, then branch from updated main for
  single-container packaging. Existing deployment data needs moving before changing mounts.

## Compose host bind mounts (current)

- User requested bind mounts. `compose.yaml` now mounts `${DATA_PATH:-./data}:/app/data`
  for initializer, API and MCP and declares no named volumes. The default host path is the
  repository's `data/`; `.env.example` documents `DATA_PATH` for an absolute host override.
  Updated storage instructions, architecture and Garmin tracker. Host directories must be
  writable by the runtime UID/GID 1000:1000; setup commands are in `docs/storage.md`.
- Validation: synthetic `docker compose --env-file /dev/null config --quiet` passes. Parsed
  `config --format json` with empty credentials and explicit synthetic origins verifies all
  three mounts are type `bind`, target `/app/data`, source the repository's `data/` by default,
  and source `/tmp/running-data-hub-bind-validation` when `DATA_PATH` is overridden. There are
  no top-level named volumes. No containers started or real directories/ownership changed.
  `pnpm run check` (75 files) and `git diff --check` pass. No application code changed in this
  follow-up, so application tests/build and the earlier image smoke were not repeated.
- Worktree `/home/edge33/dev/ai-run-coach`, branch `chore/data-directory-cleanup`, HEAD
  `2ad68a3`. All accumulated cleanup/storage changes remain uncommitted; no push or merge.
  Next: review/commit the diff, prepare the chosen host directory and move existing deployment
  data into it before starting the updated Compose stack. Local database remains empty.

## Data directory consolidation and Garmin exploration cleanup (current)

- Fetched `origin/main` and created `chore/data-directory-cleanup` at `2ad68a3` in
  `/home/edge33/dev/ai-run-coach`. Initial worktree was clean. Changes remain uncommitted;
  no push, merge, real Garmin call or historical import was performed. The user subsequently
  authorized clearing all local imported measurements and sync history (completed below).
- Removed temporary `scripts/explore-garmin.ts`, core explorer, exploration report guide,
  explorer-only test and workout response schema/case. Production mapping and API/MCP/core/DB
  regression tests remain. No ignored probe reports or diagnostic scripts were present locally.
- Default database remains `data/db/coach.sqlite`; wiki now defaults to `data/athlete_wiki`.
  Runtime image sets both absolute paths under `/app/data`, creates writable directories for
  the node user. Compose now bind-mounts `${DATA_PATH:-./data}:/app/data` across
  initializer/API/MCP, superseding the initially validated named-volume configuration.
  Added `docs/storage.md` covering bind ownership, initialization and moves from old volumes.
  Old Compose volumes are not copied automatically. `compose.yaml` is the latest-main filename.
- Updated the ignored local `.env` wiki setting from `athlete_wiki` to `data/athlete_wiki`;
  no old local wiki directory existed to move. Credentials are unchanged and remain ignored.
  User explicitly authorized clearing all local imported measurements and sync history. Before
  clearing, outside-sandbox `fuser` found no database/WAL/SHM users and `docker ps` showed no
  running containers. A one-off native Node operation against the configured
  `data/db/coach.sqlite` used `secure_delete=ON` and an immediate transaction to clear runs,
  laps, splits, samples, wellness, coverage, sync issues/history and leases, then checkpointed,
  vacuumed and truncated WAL. All nine tables verify zero rows; `integrity_check` returns `ok`
  and `foreign_key_check` returns no violations. Schema remains initialized; no backup was made.
  Credentials and wiki content were not modified by this reset. No Garmin request was made.
- Node `26.13.0`, pnpm `12.18.0`: `pnpm install --frozen-lockfile`, `pnpm run check`
  (75 files), `pnpm run typecheck`, `pnpm run lint`, `pnpm run build` pass. Install required
  outside-sandbox pnpm store access. Initial test run was blocked by sandbox loopback EPERM;
  outside-sandbox `pnpm exec turbo run test --force` passes all 79 synthetic tests (core 61,
  API 10, MCP 3, DB 5). Typecheck/lint/build reuse unchanged-workspace Turbo results.
- `BIND_IP=127.0.0.1 APP_ORIGINS=http://127.0.0.1:8080 GARMIN_API_KEY='' docker compose
  --env-file /dev/null config --quiet` passes. `docker build --target runtime -t
  running-data-hub:data-cleanup-validation .` passes. With network disabled and the disposable
  volume `running-data-hub-data-cleanup-validation` mounted only at `/app/data`, initialization,
  schema-readiness, synthetic wiki write and wiki read in a replacement container pass. Removed
  that validation volume and image tag afterwards. No real containers or volumes were changed.
- `git diff --check` passes. Next: review the uncommitted cleanup/storage diff and move any
  existing deployment data before switching mounts. Local database is initialized and empty;
  any new UI import still requires an explicitly chosen date range.
  A fresh clone does not contain these uncommitted changes or ignored local configuration/data.

## Garmin PR handoff (current)

- User authorized committing/pushing the accumulated Garmin implementation and opening a PR
  from `feature/garmin-ui-import` onto `main` (cleanup base `1e4fd86`). Scope includes UI imports,
  API/FIT contracts and normalization, SQLite storage, local API/MCP reads, deployment wiring,
  docs and retained API/MCP/core/storage tests; web tests are intentionally removed.
- Pre-publication validation: `pnpm run check` (77 files), `pnpm run typecheck`, `pnpm run lint`,
  `pnpm run build`, and `git diff --check` pass. `pnpm exec turbo run test --force` passes all
  80 synthetic tests (core 62, API 10, MCP 3, storage 5) outside the sandbox. The initial sandbox
  run failed on local sockets/subprocesses; unrestricted rerun passed. Build used Turbo cache.
- Candidate-file scan found no configured Garmin key or private data files. Ignored local
  credentials, databases, reports, diagnostic scripts and athlete wiki are excluded. No live
  Garmin calls/imports or server lifecycle changes were made during PR preparation.
- Accepted limitations: synchronous imports can exceed the proxy's 300-second timeout; a future
  queue may replace this flow. Whole-window weight validation is deferred defensive hardening,
  not a confirmed live source defect. Preserve null nightly HRV rather than substitute weekly HRV.
- Next: review and merge the Garmin PR, then continue explicit-date UI verification with local
  configuration/data. A fresh clone contains neither ignored configuration nor imported data.

## Wellness missingness investigation (current)

- User reported null wellness fields despite data visible on Garmin's website. Read-only SQLite
  inspection confirms the requested date was published by a completed import; HRV and weight
  are null, while resting HR and sleep are populated. No private measurements are recorded here.
- Four paced live read-only requests (token, original HRV range, single-day HRV, single-day weight
  range) confirm both HRV endpoints supply null lastNightAvg, despite populated weeklyAvg and
  detailed HRV readings. The weight response contains no same-day summaries. Current mapping
  faithfully preserves the missing nightly summary; it must not substitute a weekly average.
  The exact website metric remains unverified. No raw responses were saved, no import/database
  writes occurred, and no servers were started/stopped. The diagnostic script is ignored locally.
- Initial diagnostic failed before network because root cannot resolve workspace-only zod;
  corrected the import. Sandboxed network access then failed; outside-sandbox read-only checks
  succeeded. No runtime code changed or automated tests run for this investigation.
- Next: identify the website's displayed metric (nightly average versus weekly average or graph)
  before deciding whether additional HRV measurements belong in the model.
- User accepts the current proxy timeout limitation; asynchronous jobs/queues are future work.
  The synthetic wrong-date weight case is optional defensive validation, not a demonstrated live
  Garmin defect; no fix is scheduled. These decisions supersede the review's earlier next action.

## Independent Garmin code review (current)

- User requested a sub-agent review of the accumulated Garmin changes. Review found two P2
  issues: Nginx's 300-second read timeout can interrupt the synchronous import before its
  10-minute fetch deadline; weight dailyWeightSummaries entries lack whole-window date bounds
  validation and can silently become missing requested-day weight when returned for a wrong date.
  Separate previous-date/context weight fields should continue to be ignored.
- The timeout finding is based on configuration/control flow, without a timed live reproduction.
  A synthetic wrong-date weight response reproduced successful normalization to null weight.
- Review validation: `pnpm --filter @hub/core test` passes 62 tests; `git diff --check` passes.
  No runtime code changed, live Garmin requests made, or servers started/stopped during review.
- Next: address the two findings before broader UI import validation. Worktree
  `/home/edge33/dev/ai-run-coach`, branch `feature/garmin-ui-import`, HEAD `1e4fd86`;
  implementation remains uncommitted and unpublished.

## Bulk daily summaries with accepted HR fallback (current)

- User explicitly accepts Garmin's bulk restingValue falling back to minimum heart rate. This
  supersedes the earlier choice to retain per-day restingHeartRate requests. Production wellness
  now uses `/usersummary-service/v2/dailysummaries` once per at-most-31-day window, alongside
  the existing sleep, HRV and weight range endpoints. No per-day wellness requests remain in imports.
- Added named daily_range response schema for `data[].calendarDate` and optional/nullable
  `heartRate.restingValue`. Runtime validation rejects changed envelopes, nested types, bad dates,
  negative readings and duplicate/out-of-range records. Missing dates/groups/readings remain null,
  measured zero stays zero. Map restingValue exactly as supplied; do not independently use minValue.
- Keep the existing resting_hr_bpm field. The UI note, MCP get_health_data description, health metric
  definition and measurement docs disclose the minimum-HR fallback. Garmin does not label fallback
  rows, so we cannot distinguish true resting HR from fallback values in this field.
- September 1–November 12 now uses 9 daily-summary/sleep/HRV calls (3 each), plus weight/activity/
  authentication requests. Synthetic no-activity validation imports 73 rows in 16 total requests,
  down from 86 before this change. No live account request/import or server lifecycle action by agent.
- Updated synthetic fixtures, gap/zero/date checks and 73-day counts. Added nested bulk daily mapping
  and schema-error tests, including no per-day fallback requests and no independent minValue fill.
- Validation: `pnpm run check` (77 files), `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`,
  `git diff --check` pass. `pnpm exec turbo run test --force` passes all 80 synthetic tests,
  uncached: core 62, API 10, MCP 3, storage 5. No web tests added; Docker startup was not repeated
  for this endpoint/mapping change. Runtime range responses still need live UI verification.
- Worktree `/home/edge33/dev/ai-run-coach`, branch `feature/garmin-ui-import`, HEAD `1e4fd86`;
  accumulated changes remain uncommitted/unpublished. No schema reset or migration required.
  Next: user restarts their own services and retries a small explicit-date UI import respecting
  cooldown, then reviews daily_range diagnostics if any. Single-day schemas remain only for the
  separate development probe, whose historical exact-RHR observations do not redefine this choice.

## Undated sleep placeholders (current)

- User supplied a live `sleep_range` contract error at `5.calendarDate`, expected string, received
  null. The import stopped atomically with zero upserts. The supplied log does not reveal whether
  sleep duration in that row was zero/null or positive; no raw response was requested or fetched.
- Bulk sleep schema now accepts null/missing calendarDate only when sleepTimeSeconds is zero or
  null, treating such undated rows as no identifiable sleep measurement. It strips those rows
  before joining by date and never assigns a date using array position or neighboring rows.
  Their missing days remain null, not manufactured zeros. Dated zero readings are preserved.
- Undated positive sleep remains a contract failure with safe field/type diagnostics; malformed
  dates, duplicate dated entries, negative/mistyped durations and other contract failures remain
  rejected. This change cannot establish a source date for an undated positive measurement.
- Regression coverage adds mixed dated/undated empty rows, all-empty null/zero placeholders,
  omitted placeholder dates, preserved dated zero, positive undated rejection and sanitized
  diagnostics. API regression confirms safe placeholder imports and atomic preservation of
  prior wellness after an undated positive reading fails. No web tests added.
- Validation: `pnpm run check` (77 files), `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`,
  and `git diff --check` pass. `pnpm exec turbo run test --force` passes all 78 synthetic tests,
  uncached: core 60, API 10, MCP 3, storage 5. No live requests/imports, database changes, or server
  starts/restarts/stops by agent. Docker not repeated for this schema-only change.
- Worktree `/home/edge33/dev/ai-run-coach`, branch `feature/garmin-ui-import`, HEAD `1e4fd86`;
  accumulated changes remain uncommitted. Next: user reloads/restarts their services and retries
  through the UI respecting cooldown. If the same null-date error remains, the row has a positive
  duration under the new validation; keep failing rather than silently dropping or dating it.

## Bulk wellness, request pacing and cooldown (current)

- User authorized implementing rate-limit mitigation. No live requests/imports, credential edits,
  database resets/schema changes, or server start/stop were performed by the agent.
- Production imports now retrieve sleep and nightly HRV in at-most-31-day ranges using named
  response schemas. Entries require source calendar dates; duplicate/out-of-range/undated records
  fail before publication. Unsorted records join by date, missing days remain null, and zero stays
  zero. Weight still uses its range endpoint. All windows remain one atomic batch.
- Corrected the earlier 7–9-call estimate after inspecting HeartRateV2DTO: restingValue may
  substitute minimum HR. Retained daily restingHeartRate calls to preserve measurement meaning.
  September 1–November 12 uses 79 daily-summary/sleep/HRV calls instead of 219, plus weight,
  activity and token requests. A synthetic no-activity run verifies 73 rows and 86 total requests.
- Added GarminRequestGate: cancellable spacing between request starts, including token exchange
  and FIT downloads. GARMIN_REQUEST_INTERVAL_MS defaults to 1000 ms, accepts 0–60000, and is
  forwarded by Compose. This setting is not a guaranteed safe Garmin quota. The existing network
  deadline includes pacing. Tests disable actual delays and exercise pacing with an injected clock.
- A shared gate in each API instance retains server-supplied Retry-After after 429. The failed
  import saves no data; status exposes cooldown_until, UI shows the deadline and disables Sync,
  and early POST attempts return 429/GARMIN_RATE_LIMITED with Retry-After before acquiring a lease
  or contacting Garmin. Cooldown expiry unlocks the UI locally without importing. No automatic
  retries. No delay is invented when the header is absent/unusable. Cooldown is process-local,
  clears on restart and does not coordinate separate API instances; no persistence was added.
- New core/API tests cover batch joins/gaps/zeros, exact daily RHR source, duplicate/out-of-range/
  undated rejection, 73-day request reduction, token-inclusive pacing, remaining-delay calculation,
  cancellation before network, cooldown across new clients, clock expiry, status exposure,
  blocked early imports with no upstream requests/history, and no retries. No web tests added.
- Validation: `pnpm run check` (77 files), `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`,
  `git diff --check` pass. `pnpm exec turbo run test --force` passes all 76 synthetic tests,
  uncached: core 58, API 10, MCP 3, storage 5. Earlier failures were an outdated log endpoint label
  and the generic 4xx serializer stripping cooldown_until; updated the expectation and added the
  explicit 429 response schema. Final suite passes. Logs saved only in ignored/scratch locations.
- Disposable Compose config with GARMIN_API_KEY empty and GARMIN_REQUEST_INTERVAL_MS=1500 confirms
  forwarding to API. No container startup rerun; native application tests and frontend build pass.
- Worktree `/home/edge33/dev/ai-run-coach`, branch `feature/garmin-ui-import`, HEAD `1e4fd86`;
  accumulated Garmin changes remain uncommitted and unpublished. Next action: user restarts their
  own services and tests a small explicit-date UI import; inspect safe logs/cooldown if throttled.
  Range responses are validated against the public specification and synthetic fixtures, not yet
  verified with this account. Do not claim the undisclosed upstream limit is eliminated.

## Garmin rate-limit research (current)

- User reports HTTP 429 importing September 1–November 12, 2026. Checked Garmin's public Personal
  API FAQ, embedded OpenAPI reference and official Python client authentication/request code.
  No numeric request quota or reset window was found in these primary sources. Do not claim a
  specific requests-per-minute/day allowance or guaranteed cooldown. No account API calls made.
- That inclusive range is 73 dates. Current code makes 219 daily wellness calls (daily summary,
  sleep, HRV per date), plus 3 weight-range calls, authentication, activity-list pages, activity
  details and FIT downloads. Requests are sequential but have no deliberate pacing. Each failed
  reimport starts the whole selected range again. This is an avoidable high request volume; exact
  rate-limit scope (endpoint/account/IP/window) remains unconfirmed.
- Garmin documents `/usersummary-service/v2/dailysummaries` for ranges up to one year,
  `/sleep-service/sleep/dailySleepSummariesByDate` for up to 31 days and
  `/hrv-service/hrv/daily/{fromDate}/{toDate}` for HRV ranges. Range payloads use different shapes
  and need dedicated schemas/mapping plus missing-date validation before use. Potential daily
  wellness traffic is around 7–9 calls instead of 219 for this range, excluding weights/activity
  requests, depending on whether daily summaries use one range or the existing 31-day windows.
- Official FAQ says access tokens last up to 24 hours (or key expiry); Garmin's Python authenticator
  caches them. Current implementation exchanges once per import. This is a possible later request
  reduction, not an explanation for every 429 and not implemented here.
- Recommended next implementation: bulk wellness retrieval with equivalent measurement semantics,
  conservative request pacing, and visible server-supplied cooldown information, preserving manual
  UI imports and the agreed stop-on-error/no-automatic-retry behavior. Numeric safe pacing cannot
  be guaranteed from public documentation. No runtime changes or extra tests for this research.
- Sources: https://developer.garmin.com/gc-developer-program/personal/personal-faq/
  https://developer.garmin.com/gc-developer-program/personal/swagger-docs/
  https://github.com/garmin/connect-personal-api-python

## Import and HTTP failure logging (current)

- User reported HTTP 429 visible in SQLite but no server log. Confirmed the catch path previously
  persisted all import errors but logged only Garmin schema failures. No live request/import was
  made to reproduce rate limiting, and agent did not start or stop the user's servers.
- `executeSync` now logs start, activity-list completion, each staged resource window, final
  completion and every failed/interrupted outcome. A shared `sync_id` correlates client logs;
  lifecycle fields contain resource, request/record/window counts and duration. Failed publication
  always reports zero upserts. Contract details stay in the unified failed-import log.
- Garmin request failures log endpoint labels, method, request number, sanitized code, HTTP status,
  duration, parsed retry-after seconds, and numeric x-ratelimit limit/remaining fields. HTTP 429
  emits a visible warning that the import stops without retrying. Missing/unrecognized headers are
  null; HTTP-date retry-after values are converted to remaining seconds. Error-body cancellation
  failure cannot mask the original HTTP status. No retries/throttling behavior changed.
- Debug-level logs show every Garmin request start and fully received HTTP response summary.
  Import events exclude raw URLs, athlete IDs/dates, measurements, keys/tokens, response bodies,
  arbitrary headers and original network error messages. Logs remain on stderr.
- Added LOG_LEVEL guidance to `.env.example`; Compose passes `${LOG_LEVEL:-info}` to runtime.
  For native debugging set `LOG_LEVEL=debug` in ignored root `.env` and restart services.
- Added 3 core application regression tests for default-visible 429 diagnostics and failure
  outcome, no retries/private data, success/debug summaries, sanitized network errors and bad
  header values, and preservation of HTTP_429 when response-body cancellation fails.
- Validation: `pnpm run check` (74 files), `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`,
  and `git diff --check` passed. `pnpm exec turbo run test --force` passed all 69 synthetic tests,
  uncached: core 52, API 9, MCP 3, storage 5. Disposable `docker compose --env-file /dev/null
  -p running-data-hub-logging-validation config --format json` with empty Garmin credentials and
  LOG_LEVEL=debug confirmed API/MCP/initializer receive the level; no containers were started.
- Worktree `/home/edge33/dev/ai-run-coach`, branch `feature/garmin-ui-import`, HEAD `1e4fd86`;
  all accumulated changes remain uncommitted. Next: user restarts their services, then inspects
  logs on their next UI import. Logging makes rate limiting visible; it does not remove Garmin's
  limit, promise a cooldown when no header is supplied, or automatically repeat requests.

## Sleep source-date validation fix (current)

- User's UI import failed in the health phase with `GARMIN_CONTRACT_CHANGED`, contract `sleep`,
  field `calendarDate`, issue `invalid_type`. Read-only sync metadata confirmed zero published
  records. No raw athlete responses or private dates/IDs were printed or saved.
- Inspected Garmin's public Swagger page and its embedded OpenAPI schema. The dailySleep endpoint
  references `DailySleepDTO`; `calendarDate` is a string property without a required declaration.
  Our schema incorrectly required it. Public reference:
  https://developer.garmin.com/gc-developer-program/personal/swagger-docs/
- Sleep validation now permits an absent/null source calendarDate. The request supplies the storage
  day; a present source date must still be a valid date and match the requested day. Sleep duration
  still requires a nonnegative number or explicit null; missing/mistyped/negative readings fail.
  Zero remains zero. No fallback measurement or adjacent-day sleep is introduced.
- Validation logs now include expected/received type names for invalid_type issues, distinguishing
  missing/null/numeric fields without logging any values. No database schema change or reset.
- The supplied error line establishes a handled import failure, not a process crash. The user has
  not supplied an exit stack or browser trace, so a separate crash is not confirmed or claimed fixed.
  New API regression verifies a malformed source date returns failed import status, keeps previous
  measurements, releases the lease, leaves health/status/data reads available, and allows retry.
- `pnpm run check` (73 files), `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, and
  `git diff --check` passed. `pnpm exec turbo run test --force` passed all 66 synthetic tests,
  uncached: core 49, API 9, MCP 3, storage 5. No web tests added; no live import/request or server
  restart by agent. Docker was not repeated for this validation/mapping change.
- Worktree `/home/edge33/dev/ai-run-coach`, branch `feature/garmin-ui-import`, HEAD `1e4fd86`;
  accumulated changes remain uncommitted. Next: user restarts their services and retries the same
  UI import. If it still fails, inspect the new safe type diagnostics before broadening schemas.

## Web test removal (current)

- User clarified the scope: keep API, MCP, core logic and storage tests; remove only web app tests.
  Deleted both web test files (9 tests), the web test script and Vitest/jsdom/Testing Library
  dependencies. Vite configuration now imports from Vite and has no test configuration.
  Updated agent guidance and the Garmin tracker to preserve this preference.
- Runtime UI/API/MCP code is unchanged. Existing uncommitted Garmin implementation is preserved.
  The user is testing the running UI; no services were stopped and no import was started by
  the agent. The Vite configuration change may trigger its normal development reload.
- `pnpm install --lockfile-only --offline` and `pnpm install --frozen-lockfile` passed; removed
  72 unused test dependency packages without upgrading retained dependencies. Repository search
  finds no Vitest, jsdom or Testing Library references in app code or the lockfile.
- `pnpm run check` (73 files), `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, and
  `git diff --check` passed. `pnpm exec turbo run test --force` passed all 63 retained synthetic
  tests, uncached: core 47, API 8, MCP 3, storage 5. No live Garmin requests were made by tests.
  Docker validation was not repeated for test tooling removal.
- Worktree `/home/edge33/dev/ai-run-coach`, branch `feature/garmin-ui-import`, HEAD `1e4fd86`.
  All accumulated Garmin and test-removal changes remain uncommitted; no push or merge.
  Next action remains the user's UI import testing and review of those results.

## Garmin UI imports and upstream contracts (prior validation)

- Cleanup PR #14 was merged as `1e4fd86`. Created `feature/garmin-ui-import` on that base in
  `/home/edge33/dev/ai-run-coach`, then restored the Garmin checkpoint `103ee4e` as uncommitted
  implementation changes. No legacy migrations, provider adapter, or conversion path returned.
  No new commit, push, PR, merge, deployment to a real stack, or application import this step.
- Restored Garmin-only SQLite storage (one current initializer), API JSON run summaries/wellness,
  official-SDK FIT laps/splits/samples, manual atomic ingestion, local reads/summaries/MCP, UI and
  Compose wiring. Use Garmin laps and splits; source `interval*` classifications remain source values.
  The prior local reset and empty Garmin database initialization were completed before cleanup.
  Private `.env`, Garmin key, probe reports and athlete wiki remain ignored and preserved.
- Application imports run through the UI date form and Sync button, using `POST /api/sync-runs`.
  There is no application import CLI. Reads, startup and MCP never contact Garmin. No live import
  was run from a CLI or from the UI. The retained exploration script is a separate development aid.
- Added `garmin/schemas.ts` for named token, activity search/detail, daily summary, sleep, HRV,
  weight and exploratory workout response contracts. Every client JSON call requires a schema.
  Breaking required-field/type/shape/date changes throw sanitized `GARMIN_CONTRACT_CHANGED`.
  Required core summary and wellness fields accept explicit nulls. Optional device readings may
  be absent; unknown additive fields are stripped. This checks the consumed contract, not every
  unused field in the full upstream API; removed optional readings cannot always be detected.
- Moved production JSON pagination/normalization to `garmin/api.ts`, separate from the explorer.
  Contract failures abort the entire staged batch, publish no measurements or coverage, release
  the writer lease, and retain sanitized failed history. Logs include a contract name and at most
  ten field paths/issue codes, with no upstream values/body or credential. The UI explains the
  error and unchanged data after failure and on reload. Manual retry remains available.
- Regression tests cover changed containers/IDs/dates/required fields/nesting/measurement types,
  token format, additive fields, optional/nullable readings, 204 no-data responses, no implicit
  retries, atomic preservation of prior rows/coverage, API failure history, and UI failure/reload.

## Validation

Node 26.13.0 and pnpm 12.18.0:

- `pnpm install --frozen-lockfile` passed.
- `pnpm run check` (75 files), `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, and
  `git diff --check` passed.
- Outside-sandbox `pnpm exec turbo run test --force` passed all 72 synthetic tests, uncached:
  DB 5, core 47, API 8, MCP 3, web 9. No real Garmin requests/data were used.
- Disposable Compose `config --quiet`, `up --build -d --wait` and `exec nginx nginx -t` passed
  with empty credentials, `--env-file /dev/null`, loopback origins and project
  `running-data-hub-garmin-validation`. Native HTTP smoke through Nginx passed frontend/API empty
  reads, missing asset 404, untrusted-origin 403, unconfigured import 503, MCP initialize/list, and
  absence of import/sync tools. No upstream requests were possible. `down -v` removed only the
  disposable containers/network/volumes. Docker used the classic builder (Buildx is absent).
- Standalone TypeScript checking of `scripts/initialize.ts` and `scripts/explore-garmin.ts`
  passed with `--strict --noEmit --module nodenext --moduleResolution nodenext --target esnext
  --allowImportingTsExtensions --esModuleInterop --skipLibCheck`. An initial ad hoc invocation
  omitted `--strict`, causing Zod/Kysely nullable inference errors; matching repository strictness
  fixes that check without source changes.
- Final candidate-file scan found no configured key values or private data paths; no legacy
  provider environment/client or migration references remain in runtime code/configuration.
- Local dev services were previously started on UI 5174, API 3000 and MCP 3001 with matching
  APP_ORIGINS and `pnpm exec turbo run dev --env-mode=loose`. Proxy GET checks passed with an
  empty database at that time. Initial origin passthrough was corrected without changing .env.
  At the user's request, the agent-managed dev session and remaining project API/MCP watchers
  and Vite server were stopped. The user will start the servers themselves.
- Initial typecheck caught non-erasable parameter properties and a heterogeneous test-schema
  inference error; both were corrected and the final typecheck passes.

## Next action

Start the development servers and use the UI for the first explicitly dated import and review the stored run summaries, laps, splits, samples and wellness. The earlier
2026-10-19–2026-10-24 range was selected for exploration; do not infer a live application import
from that probe authorization. No implementation publication is requested yet.

## Resume commands

```bash
pnpm run check
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
BIND_IP=127.0.0.1 APP_ORIGINS=http://127.0.0.1:8080 GARMIN_API_KEY='' docker compose --env-file /dev/null -p running-data-hub-garmin-validation config --quiet
BIND_IP=127.0.0.1 APP_ORIGINS=http://127.0.0.1:8080 GARMIN_API_KEY='' docker compose --env-file /dev/null -p running-data-hub-garmin-validation up --build -d --wait
BIND_IP=127.0.0.1 docker compose --env-file /dev/null -p running-data-hub-garmin-validation exec nginx nginx -t
BIND_IP=127.0.0.1 docker compose --env-file /dev/null -p running-data-hub-garmin-validation down -v
```

Use `down -v` only for the disposable validation project. Native setup: configure ignored `.env`,
initialize a new empty database with `pnpm run db:init` if needed (no upstream access), then
`pnpm run dev`. Select import dates and click Sync in the UI. Never use an import CLI.
Socket/subprocess tests, pnpm store locking and Docker may require outside-sandbox execution.
