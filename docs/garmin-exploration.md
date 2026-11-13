# Garmin API exploration

This standalone explorer writes private reports without importing into SQLite. The application now
uses Garmin directly; see the [implementation tracker](garmin-migration-plan.md).

## Run a bounded probe

Use the pinned Node 26.13.0/pnpm 12.18.0 environment and installed development dependencies.
Set `GARMIN_API_KEY` in the ignored root `.env`, not in the tracked `.env.example`. The key is
used only by the standalone probe; application synchronization uses the same Garmin key.

The first user-selected comparison range is 2026-10-19 through 2026-10-24, inclusive:

```bash
node --env-file-if-exists=.env scripts/explore-garmin.ts --start 2026-10-19 --end 2026-10-24
```

Dates are mandatory and may span at most 31 days. The probe lists all activity types and fetches
allowlisted detail summaries for each; only supported running types receive workout/FIT extraction.
It traverses pages until an empty page, deduplicates IDs, and fails on non-advancing pagination.
The exploratory cap is 50 unique activities and 20,000 requests. Requests are sequential, limited
to 60 seconds each and 16 MiB per response, within a ten-minute network deadline. No retries occur.
HTTP errors, invalid data, ambiguous/multi-session files, or unsupported files fail the probe.

On success, stdout contains the private report path and record counts. Reports are written to
`data/garmin-probes/probe-*/report.json` with file mode 0600 inside a 0700 directory. Git and Docker
exclude `data/`. No original JSON responses, original files, GPS coordinates, free-text descriptions,
account credentials, or tokens are saved. The report itself contains private normalized athlete data;
do not commit it or copy it into documentation. Nothing is written on a failed extraction.

## Report contents and mapping

| Output | Source and interpretation |
| --- | --- |
| `activities` | Paginated search plus activity details; exact text ID, activity type, local start timestamp and normalized summary. Non-running activity summaries are exploratory evidence only, not an expanded storage scope. |
| `runs[].summary` | Activity detail `summaryDTO`: `elapsedDuration` → elapsed seconds; `duration` → timer seconds; `movingDuration` → moving seconds; distance, speeds, HR, average power, gain/loss retain meters/seconds/bpm/watts. `averageRunCadence` is steps/minute. |
| `runs[].structured_workouts` | Activity `/workouts` response with allowlisted step indices, intensity, duration/target types and values. Repetition instructions remain instructions; they are not expanded into performed intervals. Names/notes are discarded. |
| `runs[].api_split_summaries` | Detail `splitSummaries`, with `splitType` and `noOfSplits`. These are aggregates by category, not necessarily individual repetitions. Missing elapsed duration remains null even if timer time exists. |
| `runs[].fit.session` | Exactly one FIT session, decoded with Garmin's official SDK scale/offset, subfield/component and timestamp handling. Run totals can be compared with API summaries; no automatic value reconciliation. |
| `runs[].fit.laps` | Original lap sequence, source start/message timestamp, plausible end timestamp, timing warning, intensity, trigger, workout-step index, and provided measurements. No boundary inferred by adding duration. |
| `runs[].fit.splits` | Individual FIT split messages, their type, explicit start/end timestamps, first-lap/count links, elapsed/timer time and measurements. Multiple split categories can overlap; never sum all splits as disjoint intervals. |
| `runs[].fit.timer_events` | Source timer start/stop events with elapsed timestamps, for reviewing pauses without inventing moving time. |
| `runs[].fit.samples` | Original record order and timestamps relative to session start. Enhanced speed/altitude take precedence over base fields. HR/power/distance preserve source values; missing fields remain null. GPS/developer fields are not retained. |
| `wellness` | Requested local date, daily `restingHeartRate`, HRV `hrvSummary.lastNightAvg` (not weekly baseline), sleep `sleepTimeSeconds` (excluding naps), and same-day `dailyWeightSummaries.latestWeight.weight` in documented kg. Adjacent-day weight is not carried forward. |

FIT cadence components are retained separately. Running steps/minute is
`2 * (cadence + fractionalCadence)`; a missing fractional component contributes zero only when
cadence itself is present. The corresponding session conversion matches the API run-cadence values
in the selected live examples. This is a unit conversion, not interpolation or sample smoothing.

JSON integer IDs are preserved before unsafe JavaScript rounding. Dates and retained measurements
are validated at runtime. FIT CRC errors, backwards sample time, more than 200,000 samples,
more than 10,000 laps/splits/events, more than ten archive members, and more than 16 MiB of extracted
FIT data are rejected. ZIP members are decoded into memory and never extracted to source paths.

## Initial live findings, 2026-11-12

The selected-date probe succeeded using the locally configured Personal API key. Both expected
runs and the selected wellness dates were accessible. Activity detail/FIT summary comparisons
agree for retained totals within representation precision. Power and the other core sample streams
are present; missing samples stay missing. No real athlete measurements or raw responses are
recorded in this document; inspect the private report for the concrete comparison.

Important findings for the replacement design:

- Structured workout instructions, recorded laps, individual interval splits, and API aggregate
  splits are all available and are distinct datasets. Warmup/cooldown splits can span multiple
  laps. The replacement plan now names these separate collections `laps` and `splits`, following
  Garmin terminology rather than introducing an `intervals` collection.
- Source lap timestamps repeat the activity start instead of useful end times in these files.
  Rechecking with the official decoder with component expansion both enabled and disabled
  reproduces that behavior. The explorer preserves the source message time, sets impossible lap
  ends to null, and emits `LAP_TIMESTAMP_NOT_END`; it does not reconstruct the boundary.
- Individual FIT splits have explicit start/end timestamps, but some source elapsed durations
  differ from their timestamp spans. Preserve both as source evidence; exact boundary/elapsed
  semantics need review before promising lossless interval equivalence with Intervals.
- Pauses create a material difference between elapsed, timer, and moving duration. Keep them separate.
- Nightly HRV, resting HR, and sleep were available; no same-day weight entries were returned.
  Weight unit/selection mapping is documented and synthetically tested, not live-verified here.
- The responses did not expose the checked rate-limit headers. This does not prove absence of
  server limits. The selected range validates access to those dates, not arbitrary older history.
- Treadmill/trail/virtual runs, multi-session handling, and developer-field-only power still need
  account examples or explicit scope decisions. Unknown activity subtypes are listed, not silently
  classified as supported runs. The subsequent fresh-start reset is recorded in the progress log.

The current application retains workout-classified `interval*` splits and laps separately, with
source timing warnings. Exploratory reports additionally include all split categories and planned
workout instructions for source investigation; those extras are not persisted by application imports.

Sources: Garmin's [Personal API FAQ](https://developer.garmin.com/gc-developer-program/personal/personal-faq),
[OpenAPI reference](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/), and
[official JavaScript FIT SDK](https://github.com/garmin/fit-javascript-sdk).
