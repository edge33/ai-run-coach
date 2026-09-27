import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

// Use only disposable validation volumes, never the normal deployment project.
const project = 'running-data-hub-validation';
const args = ['compose', '-p', project];
const env = {
  ...process.env,
  TAILSCALE_IP: '127.0.0.1',
  APP_ORIGINS: 'http://127.0.0.1:8080',
  INTERVALS_API_KEY: '',
};
const id = '00000000-0000-4000-8000-000000000001';
function inside(service, source) {
  return execFileSync('docker', [...args, 'exec', '-T', service, 'node', '--input-type=module'], {
    env,
    input: source,
    encoding: 'utf8',
  });
}
inside(
  'api',
  `
  import assert from 'node:assert/strict';
  import { Store } from '@hub/db';
  const store = new Store(process.env.SQLITE_PATH);
  assert.equal((await store.syncHistory()).length, 0, 'Requires fresh validation volumes');
  await store.createSync({
    id: '${id}', mode: 'range', start: '2026-09-20', end: '2026-09-20',
    ranges_json: '[]', status: 'running', started_at: new Date().toISOString(),
    completed_at: null, received: 0, upserted: 0, rejected: 0, requests: 0,
    completed_windows: 0, total_windows: 2, error_code: null,
  });
  await store.close();
`,
);
inside(
  'mcp',
  `
  import { writeFile } from 'node:fs/promises';
  import { Wiki } from '@hub/core';
  await new Wiki('/app/athlete_wiki').record({
    page: 'background', key: 'fixture', value: 'Synthetic athlete',
    source: 'Explicit test fixture', expected_revision: null,
  });
  await writeFile('/app/athlete_wiki/validation.md', '# Synthetic persistence fixture');
`,
);

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 20000);
try {
  const response = await fetch(`http://127.0.0.1:8080/api/sync-runs/${id}/events`, {
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  let text = '';
  while (!text.includes(': heartbeat')) {
    const { value, done } = await reader.read();
    assert.equal(done, false);
    text += new TextDecoder().decode(value);
  }
  assert.match(text, /event: progress/);
  assert.match(text, /"status":"running"/);
  await reader.cancel();
} finally {
  clearTimeout(timeout);
  controller.abort();
}
inside(
  'api',
  `
  import { Store } from '@hub/db';
  const store = new Store(process.env.SQLITE_PATH);
  await store.updateSync('${id}', {status: 'completed', completed_at: new Date().toISOString()});
  await store.close();
`,
);
await promisify(execFile)(
  'docker',
  [...args, 'up', '-d', '--force-recreate', '--no-deps', '--wait', 'api', 'mcp', 'nginx'],
  { env, timeout: 120000 },
);
inside(
  'api',
  `
  import assert from 'node:assert/strict';
  import { Store } from '@hub/db';
  const store = new Store(process.env.SQLITE_PATH);
  assert.equal((await store.syncHistory()).length, 1);
  assert.equal((await store.syncRun('${id}')).status, 'completed');
  assert.equal(store.sqlite.pragma('integrity_check', {simple: true}), 'ok');
  await store.close();
`,
);
inside(
  'mcp',
  `
  import assert from 'node:assert/strict';
  import { readFile } from 'node:fs/promises';
  import { Store } from '@hub/db';
  const store = new Store(process.env.SQLITE_PATH);
  assert.equal((await store.syncRun('${id}')).status, 'completed');
  assert.match(await readFile('/app/athlete_wiki/validation.md', 'utf8'), /Synthetic/);
  await store.close();
`,
);
const containers = execFileSync('docker', [...args, 'ps', '--format', 'json'], {
  env,
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
const published = containers.flatMap((container) =>
  (container.Publishers ?? []).filter((port) => port.PublishedPort > 0),
);
assert.equal(published.length, 1);
assert.equal(published[0].URL, '127.0.0.1');
assert.equal(published[0].PublishedPort, 8080);
assert.ok(containers.every((container) => container.Health === 'healthy'));
process.stdout.write('Nginx SSE, persistence, shared SQLite, health, and port isolation passed.\n');
