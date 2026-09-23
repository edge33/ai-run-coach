import { addDays, localToday, type SyncRequest, syncRunSchema } from '@hub/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { api, useStatus } from './api.ts';
import { DateFilter, Empty, ErrorNotice } from './components.tsx';

export function Synchronization() {
  const status = useStatus();
  const today = status.data?.today ?? localToday('Europe/Rome');
  const client = useQueryClient();
  const [range, setRange] = useState({ start: addDays(today, -13), end: today });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ['sync-history'],
    queryFn: () => api('/sync-runs', z.array(syncRunSchema)),
  });
  const progress = useQuery({
    queryKey: ['active-sync'],
    queryFn: async () => status.data?.active ?? null,
    enabled: false,
  });
  const details = useQuery({
    queryKey: ['sync-details', selectedId],
    enabled: !!selectedId,
    queryFn: () =>
      api(
        `/sync-runs/${selectedId}`,
        z.object({
          run: syncRunSchema,
          issues: z.array(
            z.object({
              id: z.string(),
              resource: z.string(),
              code: z.string(),
              record_ref: z.string().nullable(),
            }),
          ),
        }),
      ),
  });
  const mutation = useMutation({
    mutationFn: (request: SyncRequest) =>
      api('/sync-runs', syncRunSchema, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }),
    onSuccess: (run) => {
      client.setQueryData(['active-sync'], run);
      void client.invalidateQueries({ queryKey: ['status'] });
      void client.invalidateQueries({ queryKey: ['sync-history'] });
    },
  });
  const active =
    progress.data?.status === 'running' && progress.data.id === status.data?.active?.id
      ? progress.data
      : status.data?.active;
  const busy = mutation.isPending || !!status.data?.active;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOU SET THE PACE</p>
          <h1>Bring your notebook up to date.</h1>
          <p>Imports happen only when you start them. Browsing never contacts Intervals.icu.</p>
        </div>
      </div>
      <ErrorNotice error={mutation.error ?? history.error} />
      <div className="sync-options">
        <section className="panel">
          <span className="option-number">01 / EVERYDAY</span>
          <h2>Sync recent data</h2>
          <p>Refresh runs and health from the last 14 days, including recent edits.</p>
          <button type="button" disabled={busy} onClick={() => mutation.mutate({ mode: 'recent' })}>
            {mutation.isPending ? 'Starting…' : 'Sync recent'}
          </button>
        </section>
        <section className="panel">
          <span className="option-number">02 / LOOK BACK</span>
          <h2>Choose your dates</h2>
          <p>Import an earlier run or revisit a specific date range.</p>
          <DateFilter range={range} onChange={setRange} />
          <button
            type="button"
            disabled={busy || range.end > today}
            onClick={() => mutation.mutate({ mode: 'range', ...range })}
          >
            Sync date range
          </button>
        </section>
        <section className="panel">
          <span className="option-number">03 / RECONCILE</span>
          <h2>Refresh imported history</h2>
          <p>Check every previously imported range for changes at the source.</p>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => mutation.mutate({ mode: 'all' })}
          >
            Refresh all history
          </button>
        </section>
      </div>
      {active ? (
        <section className="panel" aria-live="polite">
          <div className="section-heading">
            <h2>Import in progress</h2>
            <span className="badge">
              {active.completed_windows} / {active.total_windows} windows
            </span>
          </div>
          <progress max={Math.max(1, active.total_windows)} value={active.completed_windows} />
          <p>
            {active.upserted} records saved · {active.rejected} unavailable · {active.requests}{' '}
            requests
          </p>
          <p className="muted">You can leave this page. The server will finish the import.</p>
        </section>
      ) : null}
      <section className="panel">
        <div className="section-heading">
          <h2>Import history</h2>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              void history.refetch();
              void status.refetch();
            }}
          >
            Refresh status
          </button>
        </div>
        {history.isPending ? (
          <p role="status">Loading history…</p>
        ) : history.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Started (UTC)</th>
                  <th>Date range</th>
                  <th>Saved</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((run) => (
                  <tr key={run.id}>
                    <td>{run.started_at.slice(0, 16).replace('T', ' ')}</td>
                    <td>
                      {run.start} → {run.end}
                    </td>
                    <td>{run.upserted}</td>
                    <td>
                      <span className={`badge ${run.status}`}>{run.status}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setSelectedId(run.id)}
                      >
                        Details
                      </button>
                      {['failed', 'partial', 'interrupted'].includes(run.status) ? (
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            mutation.mutate(
                              run.mode === 'range'
                                ? { mode: 'range', start: run.start, end: run.end }
                                : { mode: run.mode },
                            )
                          }
                        >
                          Retry
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="A clean slate">
            Start a manual import to bring in your available data. No historical minimum required.
          </Empty>
        )}
      </section>
      {selectedId ? (
        <section className="panel">
          <h2>Import details</h2>
          <ErrorNotice error={details.error} />
          {details.data ? (
            <>
              <p>
                {details.data.run.received} received · {details.data.run.upserted} saved ·{' '}
                {details.data.run.rejected} unavailable
              </p>
              {details.data.issues.length ? (
                <ul>
                  {details.data.issues.map((issue) => (
                    <li key={issue.id}>
                      {issue.resource}: {issue.code}
                      {issue.record_ref ? ` (${issue.record_ref})` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No recorded issues.</p>
              )}
            </>
          ) : (
            <p role="status">Loading details…</p>
          )}
        </section>
      ) : null}
    </>
  );
}
