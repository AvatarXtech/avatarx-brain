import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backupState } from './backup-state.mjs';

test('creates an atomic integrity manifest for durable service state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'avatarx-backup-'));
  const source = join(root, 'registry.json');
  await writeFile(source, '{"avatars":[]}\n');
  const missing = join(root, 'missing');
  const result = await backupState({ env: { AGENT_REGISTRY_FILE: source, ANALYTICS_DATA_PATH: missing, KNOWLEDGE_STORE_PATH: missing, MEMORY_FILE: missing }, output: join(root, 'out'), now: new Date('2026-01-01T00:00:00.000Z') });
  assert.equal(result.manifest.files.length, 1);
  assert.equal(result.manifest.files[0].service, 'agents');
  assert.equal(result.manifest.files[0].sha256.length, 64);
  const saved = JSON.parse(await readFile(join(result.root, 'manifest.json'), 'utf8'));
  assert.deepEqual(saved, result.manifest);
});
