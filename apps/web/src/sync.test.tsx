import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('imports only after clicking the sync icon and waits for its result', async () => {
  let complete: (response: Response) => void = () => {};
  const importing = new Promise<Response>((resolve) => {
    complete = resolve;
  });

  const fetch = vi.fn(async (input: string, options?: RequestInit) => {
    if (options?.method === 'POST') return importing;

    if (input === '/api/status') {
      return Response.json({
        timezone: 'Europe/Rome',
        today: '2026-11-09',
        coverage: [],
        latest: null,
        active: null,
        run_count: 0,
        health_days: 0,
      });
    }

    return Response.json([]);
  });

  vi.stubGlobal('fetch', fetch);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/sync']}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await screen.findByText('A clean slate');
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);

  const button = screen.getByRole('button', { name: 'Sync recent data' }) as HTMLButtonElement;
  fireEvent.click(button);

  await waitFor(() => expect(button.disabled).toBe(true));
  expect(
    (screen.getByRole('button', { name: 'Sync date range' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  expect(
    JSON.parse(
      fetch.mock.calls.find(([, options]) => options?.method === 'POST')?.[1]?.body as string,
    ),
  ).toEqual({ mode: 'recent' });

  complete(
    Response.json({
      id: 'synthetic-sync',
      mode: 'recent',
      start: '2026-10-27',
      end: '2026-11-09',
      ranges_json: '[]',
      status: 'partial',
      started_at: '2026-11-09T10:00:00Z',
      completed_at: '2026-11-09T10:00:01Z',
      received: 3,
      upserted: 2,
      rejected: 1,
      requests: 3,
      completed_windows: 2,
      total_windows: 2,
      error_code: 'SOME_RECORDS_UNAVAILABLE',
    }),
  );

  await screen.findByText('Sync partial: 2 records saved, 1 unavailable.');
  await waitFor(() => expect(button.disabled).toBe(false));
  expect(fetch.mock.calls.filter(([input]) => input === '/api/status').length).toBeGreaterThan(1);

  client.clear();
});
