import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { loadConfig, mapActivity, mapWellness } from '@hub/core';
import { Store } from '@hub/db';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpApp } from '../src/app.ts';
import { createMcpServer } from '../src/tools.ts';

test('MCP client discovers bounded semantic tools, validates inputs, and never imports on read', async () => {
  const store = new Store(':memory:');
  await store.migrate();
  const mapped = mapActivity(
    { id: 'i123', type: 'Run', start_date_local: '2026-09-20T08:00:00', icu_intervals: [] },
    true,
  );
  await store.saveRun(mapped.run, mapped.intervals);
  await store.saveWellness(mapWellness({ id: '2026-09-20', restingHR: 50 }));
  const dir = await mkdtemp(join(tmpdir(), 'hub-mcp-'));
  const config = loadConfig({ WIKI_PATH: join(dir, 'wiki') });
  const server = createMcpServer(store, config);
  const client = new Client({ name: 'test', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(left);
  await client.connect(right);
  try {
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 11);
    assert.ok(listed.tools.every((tool) => !['sql', 'fetch', 'sync'].includes(tool.name)));
    const result = await client.callTool({ name: 'get_data_status', arguments: {} });
    const content = result.content as { type: string; text: string }[];
    assert.equal(JSON.parse(content[0].text).run_count, 1);
    const run = await client.callTool({ name: 'get_run', arguments: { id: 'i123' } });
    assert.equal(JSON.parse((run.content as { text: string }[])[0].text).run.id, 'i123');
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
  await store.migrate();
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
    assert.equal(tools.json().result.tools.length, 11);
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
  await store.migrate();
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
