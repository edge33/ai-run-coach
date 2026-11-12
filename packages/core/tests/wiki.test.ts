import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Wiki } from '../src/index.ts';

test('athlete wiki retains provenance and confirmation without a running-data database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hub-wiki-'));
  const wiki = new Wiki(directory);
  try {
    await wiki.record({
      page: 'goals',
      key: 'race',
      value: '10 km',
      source: 'User statement',
      expected_revision: null,
    });
    const page = await wiki.read('goals');
    const conflict = await wiki.record({
      page: 'goals',
      key: 'race',
      value: 'Half marathon',
      source: 'User correction',
      expected_revision: page.revision,
    });
    assert.equal(conflict.status, 'confirmation_required');
    if (conflict.status !== 'confirmation_required') throw new Error('Expected proposal');
    await wiki.confirm(conflict.proposal.id, 'Yes, change my goal');
    assert.equal((await wiki.read('goals')).facts[0].value, 'Half marathon');
    await writeFile(join(directory, 'zones.md'), 'invalid manual edit');
    assert.ok((await wiki.context()).pages.find((page) => page.page === 'zones')?.warning);
  } finally {
    await rm(directory, { recursive: true });
  }
});
