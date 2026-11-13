import { loadConfig, logger } from '@hub/core';
import { Store } from '@hub/db';
import { buildMcpApp } from './app.ts';

const config = loadConfig();
const store = new Store(config.databasePath);
await store.assertReady();
const app = buildMcpApp(store, config);
await app.listen({
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.MCP_PORT ?? 3001),
});
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    if (closing) return;
    closing = true;
    void app
      .close()
      .then(() => store.close())
      .catch(() => {
        logger.error({ code: 'SHUTDOWN_FAILED' }, 'Shutdown failed');
        process.exitCode = 1;
      });
  });
