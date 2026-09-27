import { addDays, localToday, runSchema, runSummarySchema } from '@hub/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { api, number, pace, queryString, useStatus } from './api.ts';
import { DateFilter, Empty, ErrorNotice } from './components.tsx';

export function Overview() {
  const status = useStatus();
  const today = status.data?.today ?? localToday('Europe/Rome');
  const [range, setRange] = useState({ start: addDays(today, -13), end: today });
  const summary = useQuery({
    queryKey: ['summary', range],
    queryFn: () => api(`/summaries/runs?${queryString(range)}`, runSummarySchema),
  });
  const runs = useQuery({
    queryKey: ['recent-runs', range],
    queryFn: () =>
      api(
        `/runs?${queryString({ ...range, limit: 4 })}`,
        z.object({ items: z.array(runSchema), total: z.number() }),
      ),
  });
  const values = summary.data?.values;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">THE BIG PICTURE</p>
          <h1>Every run starts somewhere.</h1>
          <p>Your recorded runs and health, together in one place.</p>
        </div>
        <Link className="button" to="/sync">
          ↻ &nbsp; Sync your data
        </Link>
      </div>
      <div className="section-heading">
        <h2>Your running at a glance</h2>
        <DateFilter range={range} onChange={setRange} />
      </div>
      <ErrorNotice error={summary.error} />
      <div className="stats">
        <article className="stat featured">
          <span>Recorded distance</span>
          <strong>
            {number(values?.distance_m?.value == null ? null : values.distance_m.value / 1000, 2)}
            <small> km</small>
          </strong>
          <p>Across {summary.data?.sample_size ?? '—'} runs</p>
        </article>
        <article className="stat">
          <span>Moving time</span>
          <strong>
            {number(values?.moving_time_s?.value == null ? null : values.moving_time_s.value / 60)}
            <small> min</small>
          </strong>
          <p>Time spent moving</p>
        </article>
        <article className="stat">
          <span>Aggregate pace</span>
          <strong>
            {pace(values?.pace_s_per_km?.value)}
            <small> /km</small>
          </strong>
          <p>Using runs with distance and time</p>
        </article>
        <article className="stat">
          <span>Elevation gained</span>
          <strong>
            {number(values?.elevation_gain_m?.value)}
            <small> m</small>
          </strong>
          <p>Recorded climbing</p>
        </article>
      </div>
      {summary.data?.warnings.map((warning) => (
        <p className="subtle-warning" key={warning}>
          {warning}
        </p>
      ))}
      <div className="overview-grid">
        <section className="panel">
          <div className="section-heading">
            <h2>Recent runs</h2>
            <Link to="/runs">View all →</Link>
          </div>
          <ErrorNotice error={runs.error} />
          {runs.isPending ? (
            <p role="status">Loading runs…</p>
          ) : runs.data?.items.length ? (
            <div>
              {runs.data.items.map((run) => (
                <Link className="run-row" key={run.id} to={`/runs/${run.id}`}>
                  <span className="run-icon" aria-hidden="true">
                    ↗
                  </span>
                  <span>
                    <strong>{run.start_time.replace('T', ' ')}</strong>
                    <small>
                      {run.indoor === null ? 'Run' : run.indoor ? 'Indoor run' : 'Outdoor run'}
                    </small>
                  </span>
                  <span className="run-distance">
                    {number(run.distance_m == null ? null : run.distance_m / 1000, 2)}
                    <small> km</small>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty title="Your first entry is waiting">
              Import your available runs to start. One run is enough.
            </Empty>
          )}
        </section>
        <section className="panel notebook">
          <p className="eyebrow">A NOTE ON YOUR DATA</p>
          <h2>A little history is still a beginning.</h2>
          <p>
            Only recorded measurements appear here. Missing values stay missing, and your agent can
            use the athlete wiki for the context behind the numbers.
          </p>
          <div className="divider" />
          <dl>
            <dt>Runs in your notebook</dt>
            <dd>{status.data?.run_count ?? '—'}</dd>
            <dt>Days with health records</dt>
            <dd>{status.data?.health_days ?? '—'}</dd>
            <dt>Latest sync</dt>
            <dd>
              {status.data?.latest
                ? `${status.data.latest.started_at.slice(0, 16).replace('T', ' ')} UTC · ${status.data.latest.status}`
                : 'Not synchronized yet'}
            </dd>
          </dl>
          <Link to="/sync">Manage imports →</Link>
        </section>
      </div>
    </>
  );
}
