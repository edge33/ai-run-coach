import { intervalSchema, runSchema } from '@hub/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';
import { api, number, pace } from './api.ts';
import { ErrorNotice, Pagination } from './components.tsx';

export function RunDetails() {
  const { id } = useParams();
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: ['run', id, offset],
    queryFn: () =>
      api(
        `/runs/${id}?interval_offset=${offset}`,
        z.object({
          run: runSchema,
          intervals: z.array(intervalSchema),
          interval_total: z.number(),
        }),
      ),
  });
  const run = query.data?.run;
  return (
    <>
      <Link to="/runs">← All runs</Link>
      <ErrorNotice error={query.error} />
      {run ? (
        <>
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {run.local_date} · {run.sport}
              </p>
              <h1>{run.name}</h1>
              <p>
                {run.start_local.replace('T', ' ')} · {run.timezone}
              </p>
            </div>
          </div>
          <div className="stats">
            <article className="stat featured">
              <span>Distance</span>
              <strong>
                {number(run.distance_m == null ? null : run.distance_m / 1000, 2)}
                <small> km</small>
              </strong>
            </article>
            <article className="stat">
              <span>Moving time</span>
              <strong>
                {number(run.moving_time_s == null ? null : run.moving_time_s / 60)}
                <small> min</small>
              </strong>
            </article>
            <article className="stat">
              <span>Pace</span>
              <strong>
                {pace(
                  run.distance_m && run.moving_time_s
                    ? (run.moving_time_s / run.distance_m) * 1000
                    : null,
                )}
                <small> /km</small>
              </strong>
            </article>
            <article className="stat">
              <span>Average HR</span>
              <strong>
                {number(run.avg_hr_bpm)}
                <small> bpm</small>
              </strong>
            </article>
          </div>
          <section className="panel">
            <h2>Recorded intervals</h2>
            {run.details_status !== 'complete' ? (
              <p className="notice">
                Latest interval details were unavailable. Any previously recorded intervals are
                retained.
              </p>
            ) : null}
            {query.data?.intervals.length ? (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Interval</th>
                        <th>Distance</th>
                        <th>Moving time</th>
                        <th>Avg. HR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.intervals.map((interval) => (
                        <tr key={interval.interval_index}>
                          <td>{interval.label ?? `Interval ${interval.interval_index + 1}`}</td>
                          <td>{number(interval.distance_m)} m</td>
                          <td>{number(interval.moving_time_s)} s</td>
                          <td>{number(interval.avg_hr_bpm)} bpm</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  total={query.data.interval_total}
                  offset={offset}
                  limit={100}
                  onChange={setOffset}
                />
              </>
            ) : (
              <p>No intervals available.</p>
            )}
          </section>
          <p className="provenance">
            Source activity {run.external_id} · Imported {run.synced_at} · Evidence {run.id}
          </p>
        </>
      ) : query.isPending ? (
        <p role="status">Loading run…</p>
      ) : null}
    </>
  );
}
