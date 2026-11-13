import assert from 'node:assert/strict';
import test from 'node:test';
import { GarminClient } from '../src/garmin/client.ts';
import { GarminRateLimitError } from '../src/garmin/errors.ts';
import { GarminRequestGate } from '../src/garmin/request-gate.ts';
import { garminResponses } from '../src/garmin/schemas.ts';

test('request pacing includes authentication and waits only for the remaining interval', async () => {
  let now = 0;
  const waits: number[] = [];
  const starts: number[] = [];
  const gate = new GarminRequestGate({
    intervalMs: 1000,
    now: () => now,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
    },
  });
  const client = new GarminClient('synthetic', {
    gate,
    fetch: async (_input, init) => {
      starts.push(now);
      now += 200;
      return init?.method === 'POST'
        ? new Response('synthetic.access.token')
        : new Response(null, { status: 204 });
    },
  });
  await client.json('/synthetic', garminResponses.hrv);
  await client.json('/synthetic', garminResponses.hrv);
  assert.deepEqual(starts, [0, 1000, 2000]);
  assert.deepEqual(waits, [800, 800]);
});

test('server cooldown survives a new client, expires by clock and never schedules retries', async () => {
  let now = 1000;
  let requests = 0;
  const gate = new GarminRequestGate({ intervalMs: 0, now: () => now });
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    requests++;
    return init?.method === 'POST'
      ? new Response('synthetic.access.token')
      : new Response('', {
          status: 429,
          headers: { 'retry-after': '120' },
        });
  };
  await assert.rejects(
    new GarminClient('synthetic', { gate, fetch }).json('/synthetic', garminResponses.hrv),
    GarminRateLimitError,
  );
  assert.equal(gate.cooldownUntil, new Date(121000).toISOString());
  await assert.rejects(
    new GarminClient('synthetic', { gate, fetch }).json('/synthetic', garminResponses.hrv),
    GarminRateLimitError,
  );
  assert.equal(requests, 2);
  now = 121000;
  assert.equal(gate.cooldownUntil, null);
  await gate.wait(new AbortController().signal);
  assert.equal(requests, 2);
});

test('pacing can be cancelled before another network request is sent', async () => {
  const controller = new AbortController();
  let now = 0;
  const gate = new GarminRequestGate({
    intervalMs: 1000,
    now: () => now,
    sleep: async (_milliseconds, signal) => {
      controller.abort();
      signal.throwIfAborted();
      now += 1000;
    },
  });
  let requests = 0;
  const client = new GarminClient('synthetic', {
    gate,
    signal: controller.signal,
    fetch: async () => {
      requests++;
      return new Response('synthetic.access.token');
    },
  });
  await assert.rejects(client.json('/synthetic', garminResponses.hrv), { name: 'AbortError' });
  assert.equal(requests, 1);
});
