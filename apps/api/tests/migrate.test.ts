import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Store } from '@hub/db';

test('deployment bootstrap prepares an empty database and is safe to repeat', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hub-migration-'));
  const database = join(directory, 'synthetic.sqlite');
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = spawnSync(process.execPath, [resolve('src/migrate.ts')], {
        env: { ...process.env, SQLITE_PATH: database, INTERVALS_API_KEY: '' },
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
    }
    const store = new Store(database);
    try {
      await store.assertReady();
      assert.deepEqual(await store.syncHistory(), []);
      assert.deepEqual(await store.db.selectFrom('runs').selectAll().execute(), []);
    } finally {
      await store.close();
    }
  } finally {
    await rm(directory, { recursive: true });
  }
});
