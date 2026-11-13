import { loadConfig } from '@hub/core';
import { Store } from '@hub/db';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './tools.ts';

const config = loadConfig();
const store = new Store(config.databasePath);
await store.assertReady();
const server = createMcpServer(store, config);
await server.connect(new StdioServerTransport());
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
  await store.close();
}
process.stdin.once('end', () => {
  void close();
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void close();
  });
