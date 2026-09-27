import { addDays, localToday, runSchema } from '@hub/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { api, number, queryString, useStatus } from './api.ts';
import { DateFilter, Empty, ErrorNotice, Pagination } from './components.tsx';

export function Runs() {
  const status = useStatus();
  const today = status.data?.today ?? localToday('Europe/Rome');
  const [range, setRange] = useState({ start: addDays(today, -30), end: today });
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: ['runs', range, offset],
    queryFn: () =>
      api(
        `/runs?${queryString({ ...range, offset })}`,
        z.object({ items: z.array(runSchema), total: z.number() }),
      ),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ONE FOOT IN FRONT OF THE OTHER</p>
          <h1>Your runs.</h1>
          <p>Road, trail, or treadmill. The details you recorded.</p>
        </div>
        <DateFilter
          range={range}
          onChange={(value) => {
            setRange(value);
            setOffset(0);
          }}
        />
      </div>
      <ErrorNotice error={query.error} />
      <section className="panel">
        {query.isPending ? (
          <p role="status">Loading runs…</p>
        ) : query.data?.items.length ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Date</th>
                    <th>Distance</th>
                    <th>Moving time</th>
                    <th>Avg. HR</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((run) => (
                    <tr key={run.id}>
                      <td>
                        <Link to={`/runs/${run.id}`}>{run.start_time.replace('T', ' ')}</Link>
                        <small>{run.indoor === 1 ? ' · Indoor' : ''}</small>
                      </td>
                      <td>{run.start_time.slice(0, 10)}</td>
                      <td>{number(run.distance_m == null ? null : run.distance_m / 1000, 2)} km</td>
                      <td>
                        {number(run.moving_time_s == null ? null : run.moving_time_s / 60)} min
                      </td>
                      <td>{number(run.avg_hr_bpm)} bpm</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination total={query.data.total} offset={offset} onChange={setOffset} />
          </>
        ) : (
          <Empty title="No runs in this range">
            Choose another date range or import your available records.
          </Empty>
        )}
      </section>
    </>
  );
}
