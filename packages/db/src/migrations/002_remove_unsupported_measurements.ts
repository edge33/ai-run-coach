import { type Kysely, sql } from 'kysely';

export const removeUnsupportedMeasurements = {
  up: async (db: Kysely<unknown>) => {
    await sql`ALTER TABLE runs DROP COLUMN max_power_w`.execute(db);
    await sql`ALTER TABLE run_intervals DROP COLUMN elevation_loss_m`.execute(db);
  },
};
