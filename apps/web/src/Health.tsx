import { wellnessSchema } from '@hub/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { api, number, queryString } from './api.ts';
import { Empty, ErrorNotice, Pagination } from './components.tsx';

export function Health() {
  const [offset, setOffset] = useState(0);
  const query = useQuery({
    queryKey: ['health', offset],
    queryFn: () =>
      api(
        `/health?${queryString({ limit: 50, offset })}`,
        z.object({ items: z.array(wellnessSchema), total: z.number() }),
      ),
  });

  return (
    <section aria-labelledby="health-heading">
      <h2 id="health-heading">Health</h2>
      <ErrorNotice error={query.error} />
      {query.isPending ? (
        <p role="status">Loading health data…</p>
      ) : query.data ? (
        query.data.items.length ? (
          <>
            <ul>
              {query.data.items.map((day) => (
                <li key={day.date}>
                  <strong>{day.date}</strong>
                  <p>
                    Resting heart rate: {number(day.resting_hr_bpm)} bpm
                    {' · '}HRV: {number(day.hrv_ms)} ms
                    {' · '}Sleep:{' '}
                    {number(day.sleep_duration_s == null ? null : day.sleep_duration_s / 3600, 1)} h
                    {' · '}Weight: {number(day.weight_kg, 1)} kg
                  </p>
                </li>
              ))}
            </ul>
            <Pagination total={query.data.total} offset={offset} onChange={setOffset} />
          </>
        ) : (
          <Empty title="No health data yet">Click Sync to retrieve recent health records.</Empty>
        )
      ) : null}
    </section>
  );
}
