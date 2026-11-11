import type { Kysely } from 'kysely';
import { Migrator } from 'kysely/migration';
import { initialMigration } from './migrations/001_initial.ts';
import { removeUnsupportedMeasurements } from './migrations/002_remove_unsupported_measurements.ts';
import { runSamples } from './migrations/003_run_samples.ts';
import type { Database } from './schema.ts';

export async function migrate(db: Kysely<Database>) {
  const migrator = new Migrator({
    db,
    provider: {
      getMigrations: async () => ({
        '001_initial': initialMigration,
        '002_remove_unsupported_measurements': removeUnsupportedMeasurements,
        '003_run_samples': runSamples,
      }),
    },
  });
  const result = await migrator.migrateToLatest();
  if (result.error) throw result.error;
}
