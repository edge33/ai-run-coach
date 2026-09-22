import {
  addDays,
  type HealthMetric,
  healthMetrics,
  healthSummarySchema,
  healthValueSchema,
  localToday,
} from '@hub/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { api, number, queryString, useStatus } from './api.ts';
import { DateFilter, Empty, ErrorNotice, Pagination } from './components.tsx';

export default function Health() {
  const status = useStatus();
  const today = status.data?.today ?? localToday('Europe/Rome');
  const [range, setRange] = useState({ start: addDays(today, -13), end: today });
  const [metric, setMetric] = useState<HealthMetric>('resting_hr');
  const [offset, setOffset] = useState(0);
  const observations = useQuery({
    queryKey: ['health', range, metric, offset],
    queryFn: () =>
      api(
        `/health?${queryString({ ...range, metric, offset })}`,
        z.object({ items: z.array(healthValueSchema), total: z.number() }),
      ),
  });
  const summary = useQuery({
    queryKey: ['health-summary', range, metric],
    queryFn: () =>
      api(`/summaries/health?${queryString({ ...range, metric })}`, healthSummarySchema),
  });
  const items = [...(observations.data?.items ?? [])].reverse();
  const maximum = Math.max(1, ...items.map((item) => item.value ?? 0));
  const metadata = healthMetrics[metric];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">THE REST OF THE PICTURE</p>
          <h1>Health, as recorded.</h1>
          <p>Observations without assumptions or readiness scores.</p>
        </div>
        <DateFilter
          range={range}
          onChange={(value) => {
            setRange(value);
            setOffset(0);
          }}
        />
      </div>
      <label className="metric-picker">
        Measurement
        <select
          value={metric}
          onChange={(event) => {
            setMetric(event.target.value as HealthMetric);
            setOffset(0);
          }}
        >
          {Object.entries(healthMetrics).map(([key, value]) => (
            <option key={key} value={key}>
              {value.definition}
            </option>
          ))}
        </select>
      </label>
      <ErrorNotice error={observations.error ?? summary.error} />
      <div className="stats">
        <article className="stat featured">
          <span>Mean</span>
          <strong>
            {number(summary.data?.mean, 1)}
            <small> {metadata.unit}</small>
          </strong>
          <p>Across {summary.data?.sample_size ?? '—'} measurements</p>
        </article>
        <article className="stat">
          <span>Minimum</span>
          <strong>
            {number(summary.data?.min, 1)}
            <small> {metadata.unit}</small>
          </strong>
        </article>
        <article className="stat">
          <span>Maximum</span>
          <strong>
            {number(summary.data?.max, 1)}
            <small> {metadata.unit}</small>
          </strong>
        </article>
        <article className="stat">
          <span>Unmeasured records</span>
          <strong>{summary.data?.missing ?? '—'}</strong>
          <p>Days returned without this measurement</p>
        </article>
      </div>
      {summary.data?.warnings.map((warning) => (
        <p className="subtle-warning" key={warning}>
          {warning}
        </p>
      ))}
      <section className="panel">
        <h2>{metadata.definition}</h2>
        {observations.isPending ? (
          <p role="status">Loading observations…</p>
        ) : items.length ? (
          <>
            <div
              className="chart"
              role="img"
              aria-label={`${metadata.definition} measurements on the current page; see the table for exact values.`}
            >
              {items.map((item) => (
                <div className="chart-column" key={item.local_date}>
                  <span className="chart-value">{number(item.value, 1)}</span>
                  <div
                    className={`chart-bar ${item.value === null ? 'missing' : ''}`}
                    style={{
                      height:
                        item.value === null ? 4 : `${Math.max(2, (item.value / maximum) * 140)}px`,
                    }}
                  />
                  <span className="chart-date">{item.local_date.slice(5)}</span>
                </div>
              ))}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Measurement</th>
                    <th>Source field</th>
                  </tr>
                </thead>
                <tbody>
                  {observations.data?.items.map((item) => (
                    <tr key={item.local_date}>
                      <td>{item.local_date}</td>
                      <td>
                        {item.value === null
                          ? 'Not measured'
                          : `${number(item.value, 2)} ${item.unit}`}
                      </td>
                      <td>{metadata.field}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              total={observations.data?.total ?? 0}
              offset={offset}
              onChange={setOffset}
            />
          </>
        ) : (
          <Empty title="No health records yet">
            Sync your available data. Measurements appear only when they exist at the source.
          </Empty>
        )}
      </section>
    </>
  );
}
