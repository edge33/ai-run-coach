import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import type { Store } from '@hub/db';
import type { Config } from './config.ts';
import { hash } from './mapping.ts';

export async function snapshot(
  store: Store,
  config: Config,
  syncId: string,
  resource: string,
  data: unknown,
) {
  const id = randomUUID();
  const relative = `${syncId}/${id}.json.gz`;
  const path = join(config.snapshotPath, relative);
  await mkdir(join(config.snapshotPath, syncId), { recursive: true });
  async function* encode() {
    yield Buffer.from(JSON.stringify(data));
  }
  try {
    // pipeline applies backpressure through the compressor and file writer.
    await pipeline(
      encode(),
      createGzip(),
      createWriteStream(`${path}.tmp`, { flags: 'wx', mode: 0o600 }),
    );
    await rename(`${path}.tmp`, path);
    await store.snapshot({
      id,
      sync_id: syncId,
      resource,
      path: relative,
      hash: hash(data),
      created_at: new Date().toISOString(),
    });
    return id;
  } catch (error) {
    await rm(`${path}.tmp`, { force: true });
    throw error;
  }
}
