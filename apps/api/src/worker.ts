import { executeSync, loadConfig, logger } from '@hub/core';
import { Store } from '@hub/db';

const config = loadConfig();
const store = new Store(config.databasePath);
try {
  const id = process.argv[2];
  if (!id) throw new Error('Missing sync ID');
  await executeSync(store, config, id, {
    progress: (run) => {
      if (process.connected) process.send?.(run);
    },
  });
} catch {
  logger.error({ code: 'SYNC_WORKER_FAILED' }, 'Sync worker failed');
  process.exitCode = 1;
} finally {
  await store.close();
  process.disconnect?.();
}
