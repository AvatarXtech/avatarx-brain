import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Phase 9 database contract is isolated and transactional', async () => {
  const root = new URL('../db/', import.meta.url);
  const ownership = JSON.parse(await readFile(new URL('ownership.json', root), 'utf8'));
  const migration = await readFile(new URL('migrations/0001_phase9.sql', root), 'utf8');
  const runner = await readFile(new URL('../scripts/migrate.sh', root), 'utf8');
  const dockerfile = await readFile(new URL('../Dockerfile.migrations', root), 'utf8');
  assert.equal(ownership.crossServiceTableAccess, false);
  assert.equal(ownership.credentialScope, 'service-only');
  assert.match(migration, /^BEGIN;/);
  assert.match(runner, /psql .*ON_ERROR_STOP=1/);
  assert.match(dockerfile, /COPY db/);
  assert.match(migration, /COMMIT;\s*$/);
  assert.match(migration, new RegExp('CREATE SCHEMA IF NOT EXISTS ' + ownership.schema + '\\b'));
  for (const foreign of ['agents', 'analytics', 'brain', 'intelligence', 'knowledge', 'memory', 'neuron'].filter((name) => name !== ownership.schema)) {
    assert.doesNotMatch(migration, new RegExp('(?:FROM|JOIN|INTO|UPDATE|TABLE)\\s+' + foreign + '\\.', 'i'));
  }
});
