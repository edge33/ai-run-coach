import assert from 'node:assert/strict';

const base = process.env.SMOKE_ORIGIN ?? 'http://127.0.0.1:8080';
for (const path of ['/', '/runs', '/health', '/sync']) {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<div id="root">/);
}
assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404);
assert.equal((await fetch(`${base}/api/missing`)).status, 404);
const status = await (await fetch(`${base}/api/status`)).json();
assert.equal(typeof status.run_count, 'number');
assert.equal(status.active, null);
const headers = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};
for (const [id, method, params] of [
  [
    1,
    'initialize',
    {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'smoke', version: '1' },
    },
  ],
  [2, 'tools/list', {}],
  [3, 'tools/call', { name: 'get_data_status', arguments: {} }],
]) {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.result);
  assert.equal(body.error, undefined);
}
assert.equal(
  (
    await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { ...headers, Origin: 'http://untrusted.invalid' },
      body: '{}',
    })
  ).status,
  403,
);
process.stdout.write('Static routes, API, MCP, and origin validation passed through Nginx.\n');
