import {
  type DateRange,
  type HealthMetric,
  type HealthSummary,
  healthMetrics,
  localToday,
  type RunSummary,
  validateRange,
} from '@hub/contracts';
import { mergeRanges, type Store } from '@hub/db';

function warningsForCoverage(
  rows: Awaited<ReturnType<Store['coverage']>>,
  resource: 'runs' | 'health',
  range: DateRange,
) {
  const merged = mergeRanges(rows.filter((r) => r.resource === resource));
  return merged.some((r) => r.start <= range.start && r.end >= range.end)
    ? []
    : ['The requested range is not fully synchronized; totals describe recorded data only.'];
}
export async function summarizeRuns(store: Store, range: DateRange): Promise<RunSummary> {
  validateRange(range);
  const rows = await store.db
    .selectFrom('runs')
    .select(['distance_m', 'moving_time_s', 'elevation_m', 'training_load'])
    .where('local_date', '>=', range.start)
    .where('local_date', '<=', range.end)
    .execute();
  const coverage = await store.coverage(range);
  const warnings = warningsForCoverage(coverage, 'runs', range);
  const values: RunSummary['values'] = {};
  for (const [key, unit] of [
    ['distance_m', 'm'],
    ['moving_time_s', 's'],
    ['elevation_m', 'm'],
    ['training_load', 'Intervals.icu load'],
  ] as const) {
    const measured = rows.filter((r) => r[key] !== null);
    values[key] = {
      value: measured.length
        ? measured.reduce((sum, row) => sum + (row[key] ?? 0), 0)
        : rows.length === 0 && warnings.length === 0
          ? 0
          : null,
      unit,
      measured: measured.length,
      missing: rows.length - measured.length,
    };
  }
  const paced = rows.filter(
    (r) =>
      r.distance_m !== null && r.distance_m > 0 && r.moving_time_s !== null && r.moving_time_s > 0,
  );
  const distance = paced.reduce((sum, r) => sum + (r.distance_m ?? 0), 0);
  values.pace_s_per_km = {
    value: distance
      ? (paced.reduce((sum, r) => sum + (r.moving_time_s ?? 0), 0) / distance) * 1000
      : null,
    unit: 's/km',
    measured: paced.length,
    missing: rows.length - paced.length,
  };
  if (Object.values(values).some((v) => v.missing > 0))
    warnings.push('Some runs lack measurements; each value reports its own denominator.');
  return {
    period: range,
    sample_size: rows.length,
    source: 'local_database',
    calculation_version: '1.0.0',
    coverage,
    warnings,
    values,
  };
}
export async function summarizeHealth(
  store: Store,
  range: DateRange,
  metric: HealthMetric,
): Promise<HealthSummary> {
  validateRange(range);
  const rows = await store.db
    .selectFrom('health_values')
    .select('value')
    .where('metric', '=', metric)
    .where('local_date', '>=', range.start)
    .where('local_date', '<=', range.end)
    .execute();
  const values = rows.flatMap((r) => (r.value === null ? [] : [r.value]));
  const coverage = await store.coverage(range);
  const { unit, definition } = healthMetrics[metric];
  return {
    period: range,
    metric,
    unit,
    definition,
    sample_size: values.length,
    observed_days: rows.length,
    missing: rows.length - values.length,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    mean: values.length ? values.reduce((s, v) => s + v, 0) / values.length : null,
    coverage,
    warnings: [
      ...warningsForCoverage(coverage, 'health', range),
      ...(values.length ? [] : ['No measurements available for this metric.']),
    ],
  };
}
export async function dataStatus(store: Store, timezone: string) {
  const [coverage, history, active, counts] = await Promise.all([
    store.coverage(),
    store.syncHistory(1),
    store.activeSync(),
    store.counts(),
  ]);
  return {
    timezone,
    today: localToday(timezone),
    coverage,
    latest: history[0] ?? null,
    active,
    ...counts,
  };
}
