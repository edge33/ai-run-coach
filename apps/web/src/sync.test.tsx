import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('imports only after clicking Sync, waits for its result, and refreshes both lists', async () => {
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

    return Response.json({ items: [], total: 0 });
  });

  vi.stubGlobal('fetch', fetch);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );

  await screen.findByText(/Maximum 3 months/);
  await waitFor(() =>
    expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe('2026-10-26'),
  );
  expect((screen.getByLabelText('End date') as HTMLInputElement).value).toBe('2026-11-09');
  await screen.findByText('No runs yet');
  await screen.findByText('No health data yet');
  expect(screen.queryByRole('navigation')).toBeNull();
  expect(screen.queryByRole('link')).toBeNull();
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);

  const button = screen.getByRole('button', { name: 'Sync' }) as HTMLButtonElement;
  fireEvent.click(button);

  await waitFor(() => expect(button.disabled).toBe(true));
  fireEvent.click(button);
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  expect(
    JSON.parse(
      fetch.mock.calls.find(([, options]) => options?.method === 'POST')?.[1]?.body as string,
    ),
  ).toEqual({ mode: 'range', start: '2026-10-26', end: '2026-11-09' });

  complete(
    Response.json({
      id: 'synthetic-sync',
      mode: 'range',
      start: '2026-10-26',
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
  expect(
    fetch.mock.calls.filter(([input]) => input.startsWith('/api/runs?')).length,
  ).toBeGreaterThan(1);
  expect(
    fetch.mock.calls.filter(([input]) => input.startsWith('/api/health?')).length,
  ).toBeGreaterThan(1);

  client.clear();
});

it('shows all-record measurements with independent 50-entry pagination unaffected by sync dates', async () => {
  const fetch = vi.fn(async (input: string) => {
    if (input === '/api/status')
      return Response.json({
        timezone: 'Europe/Rome',
        today: '2026-11-09',
        coverage: [],
        latest: null,
        active: null,
        run_count: 1,
        health_days: 1,
      });
    if (input.startsWith('/api/runs?'))
      return Response.json({
        items: [
          {
            id: 'synthetic-run',
            start_time: '2026-11-09T08:00:00',
            indoor: null,
            distance_m: 5000,
            duration_s: 1800,
            moving_time_s: 1500,
            avg_speed_mps: null,
            max_speed_mps: null,
            avg_hr_bpm: 140,
            max_hr_bpm: null,
            avg_power_w: null,
            elevation_gain_m: null,
            elevation_loss_m: null,
            avg_cadence_rpm: null,
            training_load: null,
            synced_at: '2026-11-09T10:00:00Z',
            details_status: 'complete',
          },
        ],
        total: 51,
      });
    return Response.json({
      items: [
        {
          date: '2026-11-09',
          resting_hr_bpm: 0,
          hrv_ms: null,
          sleep_duration_s: 27000,
          weight_kg: 65,
          fitness_ctl: null,
          fatigue_atl: null,
          form_tsb: null,
          training_load: null,
          synced_at: '2026-11-09T10:00:00Z',
        },
      ],
      total: 51,
    });
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );

  await screen.findByText('2026-11-09 08:00:00');
  expect(await screen.findByText(/Resting heart rate: 0 bpm/)).toBeTruthy();
  expect(screen.getByText(/Distance: 5 km/).textContent).toContain('Moving time: 25 min');
  expect(screen.getByText(/HRV: — ms/).textContent).toContain('Sleep: 7.5 h');
  expect(screen.queryByText(/Indoor|Outdoor/)).toBeNull();
  expect(fetch.mock.calls.every(([input]) => !input.includes('/summaries/'))).toBe(true);
  const runs = within(screen.getByRole('region', { name: 'Runs' }));
  const health = within(screen.getByRole('region', { name: 'Health' }));
  fireEvent.click(runs.getByRole('button', { name: 'Next' }));
  await runs.findByText('51–51 of 51');
  expect(health.getByText('1–50 of 51')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-01' } });
  expect(runs.getByText('51–51 of 51')).toBeTruthy();
  fireEvent.click(health.getByRole('button', { name: 'Next' }));
  await health.findByText('51–51 of 51');
  expect(fetch.mock.calls.some(([input]) => input === '/api/runs?limit=50&offset=50')).toBe(true);
  expect(fetch.mock.calls.some(([input]) => input === '/api/health?limit=50&offset=50')).toBe(true);
  expect(
    fetch.mock.calls.every(([input]) => !input.includes('start=') && !input.includes('end=')),
  ).toBe(true);
  client.clear();
});

it('reports failed reads without presenting them as empty lists', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'UNAVAILABLE' }, { status: 503 })),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );

  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(3));
  expect(screen.queryByText('No runs yet')).toBeNull();
  expect(screen.queryByText('No health data yet')).toBeNull();
  expect((screen.getByRole('button', { name: 'Sync' }) as HTMLButtonElement).disabled).toBe(true);
  client.clear();
});

it('validates sync dates while keeping all-record lists independent of the selection', async () => {
  const fetch = vi.fn(async (input: string, _options?: RequestInit) => {
    if (input === '/api/status')
      return Response.json({
        timezone: 'Europe/Rome',
        today: '2026-11-09',
        coverage: [],
        latest: null,
        active: null,
        run_count: 0,
        health_days: 0,
      });
    return Response.json({ items: [], total: 0 });
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
  const start = screen.getByLabelText('Start date') as HTMLInputElement;
  const end = screen.getByLabelText('End date') as HTMLInputElement;
  const sync = screen.getByRole('button', { name: 'Sync' }) as HTMLButtonElement;
  await waitFor(() => expect(sync.disabled).toBe(false));

  for (const [from, to] of [
    ['2026-08-11', '2026-11-09'], // 91 inclusive days
    ['2026-11-09', '2026-11-08'],
    ['', '2026-11-09'],
    ['2026-11-01', '2026-11-10'],
  ]) {
    fireEvent.change(start, { target: { value: from } });
    fireEvent.change(end, { target: { value: to } });
    expect(sync.disabled).toBe(true);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Runs' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Health' })).toBeTruthy();
    fireEvent.click(sync);
  }
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  expect(fetch.mock.calls.every(([input]) => !input.includes('2026-08-11'))).toBe(true);

  fireEvent.change(end, { target: { value: '2026-11-09' } });
  fireEvent.change(start, { target: { value: '2026-08-12' } });
  expect(sync.disabled).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
  const listReads = fetch.mock.calls.filter(
    ([input]) => input.startsWith('/api/runs?') || input.startsWith('/api/health?'),
  );
  expect(listReads).toHaveLength(2);
  expect(listReads.map(([input]) => input)).toEqual(
    expect.arrayContaining(['/api/runs?limit=50&offset=0', '/api/health?limit=50&offset=0']),
  );
  fireEvent.click(sync);
  await waitFor(() =>
    expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1),
  );
  const request = fetch.mock.calls.find(([, options]) => options?.method === 'POST');
  expect(JSON.parse(request?.[1]?.body as string)).toEqual({
    mode: 'range',
    start: '2026-08-12',
    end: '2026-11-09',
  });
  client.clear();
});

it('cached active status cannot disable Sync; the server rejects concurrency and permits a later retry', async () => {
  const active = {
    id: 'other-import',
    mode: 'range',
    start: '2026-11-09',
    end: '2026-11-09',
    ranges_json: '[]',
    status: 'running',
    started_at: '2026-11-09T10:00:00Z',
    completed_at: null,
    received: 0,
    upserted: 0,
    rejected: 0,
    requests: 0,
    completed_windows: 0,
    total_windows: 2,
    error_code: null,
  };
  let posts = 0;
  const fetch = vi.fn(async (input: string, options?: RequestInit) => {
    if (options?.method === 'POST') {
      posts++;
      if (posts === 1) return Response.json({ error: 'SYNC_BUSY', active }, { status: 409 });
      return Response.json({
        ...active,
        id: 'new-import',
        status: 'completed',
        completed_at: '2026-11-09T10:00:01Z',
        completed_windows: 2,
      });
    }
    if (input === '/api/status')
      return Response.json({
        timezone: 'Europe/Rome',
        today: '2026-11-09',
        coverage: [],
        latest: active,
        active,
        run_count: 0,
        health_days: 0,
      });
    return Response.json({ items: [], total: 0 });
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchInterval: false,
      },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
  await screen.findByText('No runs yet');
  expect(posts).toBe(0);
  const button = screen.getByRole('button', { name: 'Sync' }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  await screen.findByText('A synchronization is already running.');
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  await screen.findByText('Sync completed: 0 records saved, 0 unavailable.');
  await waitFor(() => expect(button.disabled).toBe(false));
  expect(posts).toBe(2);
  client.clear();
});
