import { loadConfig, logger } from '@hub/core';
import { Store } from '@hub/db';
import { buildApp } from './app.ts';

const config = loadConfig();

const store = new Store(config.databasePath);
await store.assertReady();

const app = buildApp(store, config);
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 3000) });

let closing = false;

async function shutdown() {
  if (closing) return;

  closing = true;

  await app.close();
  await store.close();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void shutdown().catch(() => {
      logger.error({ code: 'SHUTDOWN_FAILED' }, 'Shutdown failed');
      process.exitCode = 1;
    });
  });
