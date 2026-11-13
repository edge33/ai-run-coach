import assert from 'node:assert/strict';
import test from 'node:test';
import { Store } from '@hub/db';
import pino from 'pino';
import { GarminClient } from '../src/garmin/client.ts';
import { garminResponses } from '../src/garmin/schemas.ts';
import { beginSync, executeSync, loadConfig } from '../src/index.ts';
import { garminFetch } from './fixtures.ts';

function captureLogs(level = 'info') {
  const entries: Record<string, unknown>[] = [];
  const logger = pino(
    { level, base: undefined, timestamp: false },
    {
      write: (line) => {
        entries.push(JSON.parse(line));
      },
    },
  );
  return { logger, entries };
}

test('rate-limited imports log endpoint, retry guidance and failed outcome without private data or retries', async () => {
  const store = new Store(':memory:');
  await store.initialize();
  const { logger, entries } = captureLogs();
  const config = loadConfig({
    GARMIN_API_KEY: 'private-key-marker',
    GARMIN_REQUEST_INTERVAL_MS: '0',
  });
  const base = garminFetch();
  let failures = 0;
  try {
    const run = await beginSync(
      store,
      {
        mode: 'range',
        start: '2026-09-20',
        end: '2026-09-20',
      },
      config.timezone,
    );
    const result = await executeSync(store, config, run.id, {
      logger,
      fetch: async (input, init) => {
        if (String(input).includes('/sleep/')) {
          failures++;
          return new Response('private-body-marker', {
            status: 429,
            headers: {
              'retry-after': '120',
              'x-ratelimit-limit': '100',
              'x-ratelimit-remaining': '0',
            },
          });
        }
        return base(input, init);
      },
    });
    assert.equal(result.error_code, 'HTTP_429');
    assert.equal(failures, 1);
    const request = entries.find((entry) => entry.event === 'garmin_request_failed');
    assert.equal(request?.sync_id, run.id);
    assert.equal(request?.endpoint, 'sleep_range');
    assert.equal(request?.status, 429);
    assert.equal(request?.code, 'HTTP_429');
    assert.equal(request?.retry_after_s, 120);
    assert.equal(request?.rate_limit, 100);
    assert.equal(request?.rate_limit_remaining, 0);
    assert.equal(request?.level, 40);
    const failed = entries.find((entry) => entry.event === 'sync_failed');
    assert.equal(failed?.sync_id, run.id);
    assert.equal(failed?.code, 'HTTP_429');
    assert.equal(failed?.resource, 'health');
    assert.equal(failed?.upserted, 0);
    assert.equal(failed?.level, 50);
    assert.ok(entries.some((entry) => entry.event === 'sync_started'));
    assert.ok(entries.some((entry) => entry.event === 'sync_progress'));
    assert.ok(!entries.some((entry) => entry.event === 'sync_completed'));
    assert.ok(!entries.some((entry) => entry.event === 'garmin_request_started'));
    assert.equal(await store.activeSync(), null);
    const text = JSON.stringify(entries);
    for (const privateValue of [
      'private-key-marker',
      'private-body-marker',
      'synthetic.access.token',
      '2026-09-20',
      '/activity/123',
    ]) {
      assert.ok(!text.includes(privateValue));
    }
  } finally {
    await store.close();
  }
});

test('successful imports log published counts and debug request summaries', async () => {
  const store = new Store(':memory:');
  await store.initialize();
  const { logger, entries } = captureLogs('debug');
  const config = loadConfig({ GARMIN_API_KEY: 'synthetic', GARMIN_REQUEST_INTERVAL_MS: '0' });
  try {
    const run = await beginSync(
      store,
      {
        mode: 'range',
        start: '2026-09-20',
        end: '2026-09-20',
      },
      config.timezone,
    );
    const result = await executeSync(store, config, run.id, { logger, fetch: garminFetch() });
    const completed = entries.find((entry) => entry.event === 'sync_completed');
    assert.equal(result.status, 'completed');
    assert.equal(completed?.sync_id, run.id);
    assert.equal(completed?.upserted, 2);
    assert.equal(completed?.requests, result.requests);
    assert.equal(
      entries.filter((entry) => entry.event === 'garmin_response_received').length,
      result.requests,
    );
    assert.ok(!entries.some((entry) => entry.event === 'sync_failed'));
    assert.ok(!JSON.stringify(entries).includes('synthetic.access.token'));
  } finally {
    await store.close();
  }
});

test('request failure logs sanitize network errors and unrecognized retry headers', async () => {
  for (const failure of ['network', 'rate-limit', 'body-cancel']) {
    const { logger, entries } = captureLogs('debug');
    const client = new GarminClient('private-key-marker', {
      requestIntervalMs: 0,
      logger,
      fetch: async (_input, init) => {
        if (init?.method === 'POST') return new Response('synthetic.access.token');
        if (failure === 'network') throw new Error('private-network-marker');
        const body = new ReadableStream({
          cancel() {
            throw new Error('private-cancel-marker');
          },
        });
        return new Response(failure === 'body-cancel' ? body : 'private-body-marker', {
          status: 429,
          headers: {
            'retry-after': 'private-header-marker',
            'x-ratelimit-limit': 'private-header-marker',
          },
        });
      },
    });
    await assert.rejects(
      client.json('/synthetic?private-query-marker', garminResponses.sleep),
      failure === 'network' ? /NETWORK_ERROR/ : /HTTP_429/,
    );
    const failed = entries.find((entry) => entry.event === 'garmin_request_failed');
    assert.equal(failed?.endpoint, 'sleep');
    assert.equal(failed?.retry_after_s, null);
    assert.equal(failed?.rate_limit, null);
    assert.ok(!JSON.stringify(entries).includes('private-'));
  }
});
