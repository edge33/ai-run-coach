import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { loadConfig } from '@hub/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpApp } from '../src/app.ts';
import { createMcpServer } from '../src/tools.ts';

test('MCP exposes only athlete-wiki tools and preserves user-fact writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-mcp-'));
  const config = loadConfig({ WIKI_PATH: join(dir, 'wiki') });
  const server = createMcpServer(config);
  const client = new Client({ name: 'test', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(left);
  await client.connect(right);
  try {
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 5);
    assert.ok(listed.tools.every((tool) => !['sql', 'fetch', 'sync'].includes(tool.name)));
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      [
        'get_athlete_context',
        'read_wiki_page',
        'record_athlete_fact',
        'propose_wiki_change',
        'confirm_wiki_change',
      ].sort(),
    );
    const result = await client.callTool({ name: 'get_athlete_context', arguments: {} });
    assert.ok(JSON.parse((result.content as { text: string }[])[0].text).pages.length);
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
    await rm(dir, { recursive: true });
  }
});

test('Streamable HTTP serves wiki tools and validates Origin and method', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hub-http-mcp-'));
  const config = loadConfig({
    APP_ORIGINS: 'http://localhost',
    WIKI_PATH: join(directory, 'wiki'),
  });
  const app = buildMcpApp(config);
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
    assert.equal(tools.json().result.tools.length, 5);
    const call = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers,
      payload: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_athlete_context', arguments: {} },
      },
    });
    assert.ok(JSON.parse(call.json().result.content[0].text).pages.length);
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
    await rm(directory, { recursive: true });
  }
});

test('native TypeScript stdio exposes wiki context without a database', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-stdio-'));
  const client = new Client({ name: 'stdio-test', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('src/stdio.ts')],
    env: { ...process.env, WIKI_PATH: join(dir, 'wiki') } as Record<string, string>,
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
    const result = await client.callTool({ name: 'get_athlete_context', arguments: {} });
    assert.ok(JSON.parse((result.content as { text: string }[])[0].text).pages.length);
  } finally {
    await client.close();
    await rm(dir, { recursive: true });
  }
});
