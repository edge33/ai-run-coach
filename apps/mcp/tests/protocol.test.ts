import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { runSampleSchema } from '@hub/contracts';
import { loadConfig } from '@hub/core';
import { Store } from '@hub/db';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { syntheticRun, syntheticWellness } from '../../../packages/core/tests/fixtures.ts';
import { buildMcpApp } from '../src/app.ts';
import { createMcpServer } from '../src/tools.ts';

test('MCP client discovers bounded semantic tools, validates inputs, and never imports on read', async () => {
  const store = new Store(':memory:');
  await store.initialize();
  await store.saveRun(
    syntheticRun({ id: 'i123' }),
    [],
    [],
    [0, 5].map((elapsed, index) =>
      runSampleSchema.parse({
        run_id: 'i123',
        sample_index: index,
        elapsed_s: elapsed,
        hr_bpm: index === 0 ? 100 : null,
      }),
    ),
  );
  await store.saveWellness(syntheticWellness({ resting_hr_bpm: 50 }));
  const dir = await mkdtemp(join(tmpdir(), 'hub-mcp-'));
  const config = loadConfig({ WIKI_PATH: join(dir, 'wiki') });
  const server = createMcpServer(store, config);
  const client = new Client({ name: 'test', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(left);
  await client.connect(right);
  try {
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 18);
    assert.ok(listed.tools.every((tool) => !['sql', 'fetch', 'sync'].includes(tool.name)));
    const result = await client.callTool({ name: 'get_data_status', arguments: {} });
    const content = result.content as { type: string; text: string }[];
    assert.equal(JSON.parse(content[0].text).run_count, 1);
    const run = await client.callTool({ name: 'get_run', arguments: { id: 'i123' } });
    assert.equal(JSON.parse((run.content as { text: string }[])[0].text).run.id, 'i123');
    const samples = await client.callTool({
      name: 'get_run_samples',
      arguments: { id: 'i123', limit: 1, offset: 1 },
    });
    const samplePage = JSON.parse((samples.content as { text: string }[])[0].text);
    assert.equal(samplePage.total, 2);
    assert.equal(samplePage.items[0].elapsed_s, 5);
    assert.equal(samplePage.items[0].hr_bpm, null);
    const invalidSamples = await client.callTool({
      name: 'get_run_samples',
      arguments: { id: 'i123', limit: 101 },
    });
    assert.equal(invalidSamples.isError, true);
    const health = await client.callTool({
      name: 'get_health_data',
      arguments: { start: '2026-09-20', end: '2026-09-20' },
    });
    assert.equal(
      JSON.parse((health.content as { text: string }[])[0].text).items[0].resting_hr_bpm,
      50,
    );
    assert.equal((await store.syncHistory()).length, 0);
    const invalid = await client.callTool({
      name: 'list_runs',
      arguments: { start: '2026-09-20', end: '2026-09-21', limit: 1000 },
    });
    assert.equal(invalid.isError, true);
    const fact = await client.callTool({
      name: 'record_athlete_fact',
      arguments: {
        page: 'goals',
        key: 'distance',
        value: '10 km',
        source: 'User explicitly requested a 10 km goal',
        expected_revision: null,
      },
    });
    assert.equal(fact.isError, undefined);
    const page = await client.callTool({ name: 'read_wiki_page', arguments: { page: 'goals' } });
    assert.match(JSON.stringify(page), /10 km/);
  } finally {
    await client.close();
    await server.close();
    await store.close();
    await rm(dir, { recursive: true });
  }
});

test('Streamable HTTP initializes, lists and calls tools; validates Origin and method', async () => {
  const store = new Store(':memory:');
  await store.initialize();
  const config = loadConfig({ APP_ORIGINS: 'http://localhost' });
  const app = buildMcpApp(store, config);
  const headers = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  };
  try {
    const init = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers,
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      },
    });
    assert.equal(init.statusCode, 200);
    assert.equal(init.json().result.serverInfo.name, 'running-data-hub');
    const tools = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers,
      payload: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    });
    assert.equal(tools.statusCode, 200);
    assert.equal(tools.json().result.tools.length, 18);
    const call = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers,
      payload: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_data_status', arguments: {} },
      },
    });
    assert.equal(JSON.parse(call.json().result.content[0].text).run_count, 0);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/mcp',
          headers: { ...headers, origin: 'http://evil.example' },
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal((await app.inject({ url: '/mcp' })).statusCode, 405);
  } finally {
    await app.close();
    await store.close();
  }
});

test('native TypeScript stdio process emits only MCP protocol and returns the same records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-stdio-'));
  const path = join(dir, 'db.sqlite');
  const store = new Store(path);
  await store.initialize();
  await store.close();
  const client = new Client({ name: 'stdio-test', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('src/stdio.ts')],
    env: { ...process.env, SQLITE_PATH: path, WIKI_PATH: join(dir, 'wiki') } as Record<
      string,
      string
    >,
    stderr: 'pipe',
  });
  try {
    let stderr = '';
    transport.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    await client.connect(transport).catch((error) => {
      throw new Error(`${error.message}: ${stderr}`);
    });
    const result = await client.callTool({ name: 'get_data_status', arguments: {} });
    assert.equal(JSON.parse((result.content as { text: string }[])[0].text).run_count, 0);
  } finally {
    await client.close();
    await rm(dir, { recursive: true });
  }
});

test('MCP persists draft plans, explicit acceptance and attributed journal entries without syncing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-coaching-mcp-'));
  const store = new Store(':memory:');
  await store.initialize();
  const server = createMcpServer(store, loadConfig({ WIKI_PATH: join(dir, 'wiki') }));
  const client = new Client({ name: 'coach-test', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(left);
  await client.connect(right);
  const call = (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args });
  const decode = (result: Awaited<ReturnType<typeof call>>) =>
    JSON.parse((result.content as { text: string }[])[0].text);
  try {
    const operationId = randomUUID();
    const draft = {
      plan_id: 'consistency',
      operation_id: operationId,
      expected_version: 0,
      plan: {
        start: '2026-11-16',
        end: '2026-11-22',
        timezone: 'Europe/Rome',
        objective: 'Consistent running',
        context: 'User has three available days',
        evidence: 'User report on 2026-11-15; no measured history',
        change_reason: 'Initial plan',
        sessions: [
          {
            id: randomUUID(),
            date: '2026-11-16',
            purpose: 'Easy run',
            duration_s: 1200,
            distance_m: null,
            intensity: 'Easy',
            instructions: 'Run comfortably',
            alternative: null,
          },
        ],
      },
    };
    const saved = await call('save_training_plan', draft);
    assert.equal(saved.isError, undefined);
    assert.equal(decode(saved).version, 1);
    assert.deepEqual(decode(await call('save_training_plan', draft)), decode(saved));
    let listed = decode(await call('list_training_plans', {}));
    assert.equal(listed.active, null);
    const accepted = await call('decide_training_plan', {
      operation_id: randomUUID(),
      expected_revision: listed.revision,
      action: 'accept',
      target: { plan_id: 'consistency', version: 1 },
      confirmation: 'User: Yes, follow version 1',
    });
    assert.equal(accepted.isError, undefined);
    listed = decode(await call('list_training_plans', {}));
    assert.equal(listed.active.version, 1);
    assert.equal(
      decode(await call('read_training_plan', { plan_id: 'consistency', version: 1 })).status,
      'accepted',
    );
    const stale = await call('save_training_plan', { ...draft, operation_id: randomUUID() });
    assert.equal(stale.isError, true);
    assert.match(JSON.stringify(stale.content), /Plan changed/);
    const invalid = await call('save_training_plan', {
      ...draft,
      operation_id: randomUUID(),
      expected_version: 1,
      plan: { ...draft.plan, sessions: [{ ...draft.plan.sessions[0], date: '2026-12-01' }] },
    });
    assert.equal(invalid.isError, true);
    const report = {
      id: randomUUID(),
      date: '2026-11-15',
      kind: 'check_in',
      author: 'athlete',
      content: 'Slept poorly last night',
      source: 'User: Slept poorly last night',
      applies_until: null,
      session: { plan_id: 'consistency', session_id: draft.plan.sessions[0].id },
      activity_id: null,
      replaces: null,
    };
    assert.equal((await call('append_coaching_journal', report)).isError, undefined);
    const journal = decode(
      await call('read_coaching_journal', { start: '2026-11-15', end: '2026-11-15' }),
    );
    assert.equal(journal.total, 1);
    assert.equal(journal.items[0].author, 'athlete');
    assert.equal(
      (await call('read_coaching_journal', { start: '2026-11-16', end: '2026-11-15' })).isError,
      true,
    );
    assert.equal((await store.syncHistory()).length, 0);
    const tools = (await client.listTools()).tools;
    assert.equal(
      tools.find((tool) => tool.name === 'save_training_plan')?.annotations?.readOnlyHint,
      false,
    );
    assert.equal(
      tools.find((tool) => tool.name === 'read_coaching_journal')?.annotations?.readOnlyHint,
      true,
    );
  } finally {
    await client.close();
    await server.close();
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
