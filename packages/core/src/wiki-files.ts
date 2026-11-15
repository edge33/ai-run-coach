import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';

export async function readWikiFile(path: string, maxBytes = 600000): Promise<string | null> {
  try {
    if ((await stat(path)).size > maxBytes) throw new Error('Wiki document too large');
    const content = await readFile(path, 'utf8');
    if (Buffer.byteLength(content) > maxBytes) throw new Error('Wiki document too large');
    return content;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function atomicWikiWrite(path: string, content: string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
