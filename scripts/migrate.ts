// Deployment bootstrap only; imports are initiated through the web UI/API.
import { loadConfig, logger } from '../packages/core/src/config.ts';
import { Store } from '../packages/db/src/index.ts';

const store = new Store(loadConfig().databasePath);
try {
  await store.migrate();
  logger.info('Migrations complete');
} finally {
  await store.close();
}
