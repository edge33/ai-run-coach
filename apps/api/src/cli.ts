import { backup, beginSync, executeSync, exportData, loadConfig, logger, restore } from '@hub/core';
import { Store } from '@hub/db';

const config = loadConfig();
const [command, first, second] = process.argv.slice(2);
if (command === 'restore') {
  if (!first || !second) throw new Error('Usage: npm run restore -- BACKUP_DIR EMPTY_DESTINATION');
  logger.info(
    await restore(first, second),
    'Restore complete; point configuration to the new destination',
  );
} else {
  const store = new Store(config.databasePath);
  try {
    if (command === 'migrate') {
      await store.migrate();
      logger.info('Migrations complete');
    } else if (command === 'sync') {
      const request =
        first === 'all'
          ? { mode: 'all' as const }
          : first && second
            ? { mode: 'range' as const, start: first, end: second }
            : { mode: 'recent' as const };
      const run = await beginSync(store, request, config.timezone);
      const result = await executeSync(store, config, run.id);
      logger.info({ id: result.id, status: result.status }, 'Manual sync finished');
      if (result.status !== 'completed') process.exitCode = 1;
    } else if (command === 'backup' || command === 'export') {
      if (!first) throw new Error('A destination directory is required');
      const result =
        command === 'backup'
          ? await backup(store, config, first)
          : await exportData(store, config, first);
      logger.info(result, 'Data saved');
    } else throw new Error('Unknown command');
  } finally {
    await store.close();
  }
}
