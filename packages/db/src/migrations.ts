import type { Kysely } from 'kysely';
import { Migrator } from 'kysely/migration';
import { initialMigration } from './migrations/001_initial.ts';
import type { Database } from './schema.ts';

export async function migrate(db: Kysely<Database>) {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: async () => ({ '001_initial': initialMigration }) },
  });
  const result = await migrator.migrateToLatest();
  if (result.error) throw result.error;
}
