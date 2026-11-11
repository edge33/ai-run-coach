# Run analysis measurements

Manual synchronization imports normalized run summaries, source intervals, and aligned sample
streams. Weather, surface, goals, availability, athlete settings, and coaching interpretation remain
wiki/agent concerns. GPS and additional running dynamics are outside this change.

Compose runs the dedicated migration bootstrap before starting updated services. Migration `003_run_samples` adds an empty
STRICT sample table and nullable fields to existing runs and intervals. It preserves existing
measurements; migrations 001 and 002 are unchanged. Existing runs have `samples_synced_at: null`
until their dates are explicitly synchronized again. Migrations and reads never fetch upstream data.
Use explicit ranges of at most 90 inclusive local dates to backfill longer history in multiple requests.
Select those dates in the web UI and click Sync. Every import fetches the full approved dataset for
those dates, including previously imported records. No general CLI or history-based import mode remains.

## Stored records

`runs` additionally retains `power_source` from activity `power_field` and `samples_synced_at`.
The latter is null before stream import; after a successful import it equals the parent `synced_at`.
A successful, valid empty stream response has a non-null timestamp and zero samples.

`run_intervals` additionally retains nullable `label`, `start_index`, `end_index`, `start_time_s`,
`end_time_s`, and `moving_time_s`. Indices identify stream samples, not elapsed seconds; `end_index`
is exclusive. Times preserve upstream activity-relative seconds. Existing `duration_s` remains elapsed
duration. Boundaries are not reconstructed from durations or invented when absent.

`run_samples` has primary key `(run_id, sample_index)` and a cascading FK to `runs`:

| Column | Upstream stream | Units / semantics |
| --- | --- | --- |
| `sample_index` | Array position | Zero-based original order |
| `elapsed_s` | `time` | Seconds since activity start; required |
| `distance_m` | `distance` | Cumulative meters |
| `speed_mps` | `velocity_smooth` | Meters per second; source-provided smoothed speed |
| `hr_bpm` | `heartrate` | Beats per minute |
| `power_w` | `watts` | API-selected watts; upstream may substitute corrected `fixed_watts` |
| `raw_power_w` | `raw_watts` | Original watts, explicitly requested separately |
| `altitude_m` | `altitude` | Original altitude in meters; may be negative |
| `corrected_altitude_m` | `fixed_altitude` | Corrected altitude in meters; may be negative |
| `cadence_rpm` | `cadence` | RPM; running steps/minute is explicitly 2 × RPM |

Column identities preserve original/corrected streams without a generic provenance model.
`power_source` identifies the selected activity power field; it does not certify power quality.
Source arrays are not retained as JSON. No substitute HR, power, gradient, or maximum statistics are
derived during ingestion. Missing measurements remain null; measured zero remains zero. Irregular
timing, duplicate timestamps, and recording gaps retain their source indices/times.

The importer requests only these nine streams, with `includeDefaults=false`. Optional absent streams
become null columns. Present streams must align with the time array. Malformed or duplicate streams,
nonfinite values, negative non-altitude measurements, backwards/null times, or more than 200,000
samples reject that activity update. Source all-null streams may omit their data array. Unknown fields
and streams are discarded. Existing HTTP timeout, response-size, and lease bounds apply. Imports do
not automatically retry failed requests, including HTTP 429 or server errors.

The complete import batch is atomic across all requested windows, runs, intervals, samples, wellness,
and coverage. Normalized rows are staged in a private disposable SQLite database during downloads,
then published in one transaction after every request and validation succeeds. The first error aborts
the batch with zero saved records; failed details/streams do not skip ahead to later records. Cancellation
or lease loss also discards staged changes. Previous data and coverage timestamps remain unchanged;
failure status and a sanitized issue remain in sync history. New imports cannot be partial. Temporary
staging files are removed on normal completion/failure; a hard process/host crash can leave orphaned
private staging directories under the OS temporary directory. No credentials or raw source JSON are staged.

A valid empty response clears prior samples only when the entire batch succeeds. Available interval
boundaries must be ordered and fit the sample array when samples exist. Interval labels are untrusted
source text. Coverage describes the last committed snapshot, not the current state of upstream after
a failed refresh; agents must inspect the latest sync status before using older measurements as fresh.

An import is active only while it owns the unexpired writer lease. The form disables its controls
for its own pending request; server concurrency checks reject genuinely overlapping requests. A stale
cached status cannot permanently block Sync after a crash. Once an abandoned lease expires (normally
within 60 seconds of its last renewal), the next web import can recover the old history as interrupted.
No polling, focus/reconnect refetching, automatic imports, or upstream reads are added for recovery.

## Local retrieval and export

```text
GET /api/runs/:id
GET /api/runs/:id/samples?limit=100&offset=0
```

Run detail keeps existing interval pagination and includes the new interval/provenance fields.
Sample reads return `run_id`, `synced_at`, `power_source`, `items`, `total`, `limit`, and `offset`.
Each item has the sample columns above plus `run_id`. Pages are ordered by sample index, with
`limit` 1–100 and `offset` 0–200,000. Unknown runs return HTTP 404; existing runs without imported
samples return an empty page. The timestamp, items, and total share a read transaction. If a sync
changes `synced_at` between pages, restart pagination rather than combining different imports.

MCP `get_run_samples` accepts `id`, `limit`, and `offset` with the same bounds and returns the same
page (null for an unknown run). Both transports use the shared registry. No read contacts upstream.
The core `exportData` function includes a `samples` array in `records.json`; there is no export CLI.

## Upstream evidence

- [Public OpenAPI](https://intervals.icu/api/v1/docs): activity streams, selected `power_field`,
  interval indices/times/moving time/label, and raw versus corrected watts behavior.
- [Developer-published interval model](https://forum.intervals.icu/t/server-side-data-model-for-scripts/25781):
  start-inclusive/end-exclusive indices; activity-relative times are not sample indices.
- [Developer running-metrics documentation](https://forum.intervals.icu/t/new-running-metrics/132173):
  cadence stream uses RPM, with running steps/minute twice RPM.
