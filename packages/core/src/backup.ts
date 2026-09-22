import { randomUUID } from 'node:crypto';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { Store } from '@hub/db';
import type { Config } from './config.ts';
import { hash } from './mapping.ts';
import { Wiki } from './wiki.ts';

async function files(path: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const item of await readdir(join(path, prefix), { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error('Symlinks are not supported in backups');
    const name = join(prefix, item.name);
    if (item.isDirectory()) result.push(...(await files(path, name)));
    else result.push(name);
  }
  return result.sort();
}
async function emptyDirectory(path: string) {
  await mkdir(path, { recursive: true });
  if ((await readdir(path)).length) throw new Error(`Destination must be empty: ${path}`);
}
export async function backup(store: Store, config: Config, destination: string) {
  const target = resolve(destination);
  for (const source of [config.snapshotPath, config.wikiPath]) {
    const rel = relative(source, target);
    if (!rel || (!rel.startsWith('..') && !rel.startsWith('/')))
      throw new Error('Backup must be outside source directories');
  }
  const owner = `backup-${randomUUID()}`;
  if (!(await store.acquireLease(owner, Date.now(), 3600000)))
    throw new Error('Stop the active sync before backing up');
  try {
    return await new Wiki(config.wikiPath).locked(async () => {
      await emptyDirectory(target);
      await mkdir(config.snapshotPath, { recursive: true });
      await files(config.wikiPath);
      await files(config.snapshotPath);
      await store.sqlite.backup(join(target, 'coach.sqlite'));
      await cp(config.snapshotPath, join(target, 'snapshots'), { recursive: true });
      await cp(config.wikiPath, join(target, 'wiki'), {
        recursive: true,
        filter: (source) => resolve(source) !== resolve(config.wikiPath, '.write-lock'),
      });
      const checksums: Record<string, string> = {};
      for (const file of await files(target))
        checksums[file] = hash((await readFile(join(target, file))).toString('base64'));
      await writeFile(
        join(target, 'manifest.json'),
        JSON.stringify({ version: 1, created_at: new Date().toISOString(), checksums }, null, 2),
      );
      return { destination: target, files: Object.keys(checksums).length };
    });
  } finally {
    await store.releaseLease(owner);
  }
}
export async function restore(source: string, destination: string) {
  const origin = resolve(source);
  const target = resolve(destination);
  const manifest = JSON.parse(await readFile(join(origin, 'manifest.json'), 'utf8')) as {
    version: number;
    checksums: Record<string, string>;
  };
  if (manifest.version !== 1 || typeof manifest.checksums !== 'object')
    throw new Error('Invalid backup manifest');
  const entries = (await files(origin)).filter((file) => file !== 'manifest.json');
  if (entries.length !== Object.keys(manifest.checksums).length)
    throw new Error('Backup file set mismatch');
  for (const file of entries) {
    if (hash((await readFile(join(origin, file))).toString('base64')) !== manifest.checksums[file])
      throw new Error('Backup checksum mismatch');
  }
  await emptyDirectory(target);
  await cp(join(origin, 'coach.sqlite'), join(target, 'coach.sqlite'));
  await cp(join(origin, 'snapshots'), join(target, 'snapshots'), { recursive: true });
  await cp(join(origin, 'wiki'), join(target, 'wiki'), { recursive: true });
  const restored = new Store(join(target, 'coach.sqlite'));
  try {
    if (restored.sqlite.pragma('integrity_check', { simple: true }) !== 'ok')
      throw new Error('Restored database failed integrity check');
    await restored.db.deleteFrom('leases').execute();
    await restored.recoverInterrupted();
    return { destination: target, ...(await restored.counts()) };
  } finally {
    await restored.close();
  }
}
export async function exportData(store: Store, config: Config, destination: string) {
  // A verified backup contains JSON provenance, Markdown, and the complete SQLite database.
  const result = await backup(store, config, destination);
  const snapshot = new Store(join(destination, 'coach.sqlite'));
  try {
    const data = {
      runs: await snapshot.db.selectFrom('runs').selectAll().execute(),
      intervals: await snapshot.db.selectFrom('run_intervals').selectAll().execute(),
      health: await snapshot.db.selectFrom('health_values').selectAll().execute(),
    };
    await writeFile(join(destination, 'records.json'), JSON.stringify(data, null, 2), {
      mode: 0o600,
    });
    const manifestPath = join(destination, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.checksums['records.json'] = hash(
      (await readFile(join(destination, 'records.json'))).toString('base64'),
    );
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    return result;
  } finally {
    await snapshot.close();
  }
}
