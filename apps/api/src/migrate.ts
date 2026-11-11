// Deployment bootstrap only; imports are initiated through the web UI/API.
import { loadConfig, logger } from '@hub/core';
import { Store } from '@hub/db';

const store = new Store(loadConfig().databasePath);
try {
  await store.migrate();
  logger.info('Migrations complete');
} finally {
  await store.close();
}
