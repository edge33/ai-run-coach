# Measurements

Run totals and wellness come from Garmin API JSON. Recorded laps, classified splits and samples
come from original FIT files. Values retain their source meaning: unknown is `null`, measured
zero stays zero, and missing days are never filled from neighboring days.

## Stored records

| Record   | Meaning                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------- |
| Run      | Exact source ID, local start time, distances, durations, speeds, HR, power, elevation and cadence |
| Lap      | A watch-recorded division, in its original sequence                                               |
| Split    | A Garmin-classified section, which can span several laps                                          |
| Sample   | A recorded point, keeping its original index, timestamp gaps and duplicate times                  |
| Wellness | Dated resting HR, nightly HRV, sleep excluding naps, and latest same-day weight in kg             |

Laps and splits describe the same activity: do not add their totals together. Keep only split
types beginning with `interval`, preserving Garmin's spelling and sequence gaps. Exclude the
overlapping run/walk/stand groups. Planned workout steps and API aggregate splits are not stored.

Cadence is total steps/minute, converted from source cycles and fractional cycles. Enhanced FIT
speed/altitude take precedence over base readings. No smoothing, resampling, developer-power
substitution or HR-message merging is performed. Negative/nonfinite measurements are invalid,
except that altitude can be negative. A virtual run is not necessarily indoors.

## Timing

- `duration_s` is elapsed time; `timer_time_s` excludes timer pauses.
- `moving_time_s` is independently supplied moving time. It never falls back to timer time.
- Sample elapsed time includes pauses and is anchored to session start.
- Preserve source boundaries; do not invent ends from durations or the next lap.

Unavailable boundaries remain null. An impossible lap end gets `LAP_TIMESTAMP_NOT_END`; an
invalid split end gets `INVALID_SOURCE_BOUNDARY`. If a valid start/end span differs from source
elapsed duration by more than two seconds, keep both and flag `DURATION_TIMESTAMP_MISMATCH`.
The tolerance allows for whole-second FIT timestamp rounding; it does not correct source values.

## Wellness and source limits

Bulk wellness responses join by calendar date. Duplicate/out-of-range dates or undated positive
sleep fail validation. Undated zero/null sleep placeholders are ignored; dated zero is retained.

`resting_hr_bpm` uses V2 `heartRate.restingValue`. Garmin may substitute minimum HR when resting
HR is unavailable; that fallback is accepted, and affected rows cannot be identified. Do not
independently substitute `minValue`. HRV is the nightly average, never the weekly value/baseline.

Live examples cover selected dates/devices, not all history. Weight mapping has synthetic
coverage but no same-day live probe example. Additional run types and older history need explicit
dated examples. Multi-session FIT files are rejected; missing required source files fail imports.

## Reading the data

Run lists and health lists have pages of at most 50. Run detail returns separate lap/split pages
of at most 100 using `lap_offset`/`split_offset`. Sample pages accept `limit` 1–100 and
`offset` 0–200000. HTTP routes and MCP tools use the same bounds. Unknown run IDs return 404/null.

Reads use consistent transactions. Restart pagination if the sample import timestamp changes.
Responses identify `garmin_connect`; exports also identify the mapping version. Treat timing
warnings, missingness, coverage and sync status as part of the data. See [architecture](architecture.md)
for import guarantees and the distinction between measured records and agent interpretation.
