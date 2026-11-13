# Garmin measurements and timing

API JSON supplies run totals and wellness. Original activity FIT files supply recorded laps,
workout-classified splits and samples. See the [implementation plan](implementation-plan.md)
for import/storage behavior.

## Records

- `runs`: source activity ID as exact text, local start timestamp, nullable indoor flag, distance,
  elapsed/timer/moving seconds, speeds, HR, average power, elevation gain/loss, cadence in total
  steps/minute, import timestamp and sample-import timestamp.
- `run_laps`: original sequence, start/end seconds relative to session start, source message time,
  intensity, lap trigger, optional workout-step reference and provided summary measurements.
- `run_splits`: original FIT sequence (gaps after filtering are intentional), Garmin `split_type`,
  explicit start/end seconds, optional first-lap/count links, and provided summary measurements.
  Retain only source types starting with `interval`, including warm-up, active, recovery, rest,
  cooldown and other source classifications. Exclude overlapping `rwdRun`/`rwdWalk`/`rwdStand` groups.
- `run_samples`: original index, elapsed seconds, cumulative distance, speed, HR, power, altitude
  and cadence in total steps/minute. Enhanced speed/altitude take precedence over base FIT values.
- `wellness`: source calendar date, resting HR, nightly average HRV, sleep excluding naps, and latest
  same-day weight in kg. Never substitute HRV baseline or carry weight from an adjacent date.

Laps are watch-recorded divisions. Splits are Garmin-classified sections and may span multiple laps.
They are two views of a run, not additional distance to add together. Workout instructions are planned
steps, not measured performance; neither they nor API aggregate split summaries are persisted.

## Timing rules

`duration_s` always retains source elapsed duration. `timer_time_s` excludes timer pauses.
`moving_time_s` retains an independently provided moving duration; never substitute timer time.

Preserve valid source start/end timestamps independently of durations. Do not infer an end by adding
elapsed duration, reconstruct boundaries from subsequent laps, or invent sample indices. Source
message timestamps are not assumed to be valid lap ends: impossible lap ends become null with
`LAP_TIMESTAMP_NOT_END`. Invalid split ends become null with `INVALID_SOURCE_BOUNDARY`.

When both endpoints exist but their span differs from source elapsed duration by more than two
seconds, retain both and mark `DURATION_TIMESTAMP_MISMATCH`. Two seconds accounts for the possible
rounding of two whole-second FIT timestamps; it is not an adjustment to either source value.
Unavailable endpoints stay null. Negative/nonfinite source timestamps or measurements are invalid,
except that altitude may be negative.

Samples retain recording gaps and duplicate timestamps in source order. Elapsed time includes pauses
and is anchored to session start, not the first record. Running cadence converts source cycles plus
fractional cycles to total steps/minute; no resampling, smoothing or developer-power substitution.

## Retrieval

`GET /api/runs/:id` and MCP `get_run` accept independent `lap_offset` and `split_offset` values,
returning up to 100 of each with separate totals. `GET /api/runs/:id/samples` and MCP
`get_run_samples` accept `limit` 1–100 and `offset` 0–200,000. Unknown run IDs return 404/null.
Run detail and sample pages report `source: garmin_connect`. Export includes the mapping version.
All reads stay local. Timing warnings are data-quality facts, not automatic rejection of an otherwise
usable recorded lap/split. Users and agents must not claim exact boundaries when they are unavailable.

Wellness sleep and HRV use dated bulk responses joined by calendar date. Missing source dates in
an otherwise valid range response produce null readings for those days. Empty undated sleep rows
(zero/null duration) are ignored without assigning dates; undated positive sleep and duplicate or
out-of-range entries fail validation. A dated zero duration remains a measured zero. `resting_hr_bpm` uses bulk V2 `data[].heartRate.restingValue`, which Garmin may fill with minimum
heart rate when resting HR is unavailable. The user accepts this tradeoff. We cannot identify
fallback rows. Missing readings remain null; we do not independently substitute `minValue`.
