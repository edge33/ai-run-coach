import { runSchema } from '@hub/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { api, number, queryString } from './api.ts';
import { Empty, ErrorNotice, Pagination } from './components.tsx';

export function Runs() {
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: ['runs', offset],
    queryFn: () =>
      api(
        `/runs?${queryString({ limit: 50, offset })}`,
        z.object({ items: z.array(runSchema), total: z.number() }),
      ),
  });

  return (
    <section aria-labelledby="runs-heading">
      <h2 id="runs-heading">Runs</h2>
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <p role="status">Loading runs…</p>
      ) : query.data ? (
        query.data.items.length ? (
          <>
            <ul>
              {query.data.items.map((run) => (
                <li key={run.id}>
                  <strong>{run.start_time.replace('T', ' ')}</strong>
                  {run.indoor === null ? '' : run.indoor ? ' · Indoor' : ' · Outdoor'}
                  <p>
                    Distance: {number(run.distance_m == null ? null : run.distance_m / 1000, 2)} km
                    {' · '}Moving time:{' '}
                    {number(run.moving_time_s == null ? null : run.moving_time_s / 60, 1)} min
                    {' · '}Average heart rate: {number(run.avg_hr_bpm)} bpm
                  </p>
                </li>
              ))}
            </ul>
            <Pagination total={query.data.total} offset={offset} onChange={setOffset} />
          </>
        ) : (
          <Empty title="No runs yet">Click Sync to retrieve recent runs.</Empty>
        )
      ) : null}
    </section>
  );
}
