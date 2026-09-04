import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryMovieEventStore, MovieEventRuntime, MovieRuntimeError } from './movie-pipeline-runtime.mjs';

const event = (type, extra = {}) => ({
  specversion: '1.1', id: crypto.randomUUID(), type, source: 'avatarx-ai-director',
  tenantId: 'tenant-a', projectId: 'movie-a', runId: 'run-a', traceId: 'trace-a',
  correlationId: 'scene-a', occurredAt: new Date().toISOString(), data: {}, ...extra
});

test('avatarx-brain processes its vertical-slice event exactly once', async () => {
  const store = new InMemoryMovieEventStore();
  const runtime = new MovieEventRuntime({ service: 'avatarx-brain', store });
  const input = event('movie.scene.direction.requested');
  const first = await runtime.ingest(input, 'tenant-a');
  const duplicate = await runtime.ingest(input, 'tenant-a');
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(first.emitted, ["movie.workflow.requested"]);
  assert.equal(store.outbox.size, 1);
});

test('avatarx-brain fails closed across tenants', async () => {
  const runtime = new MovieEventRuntime({ service: 'avatarx-brain' });
  await assert.rejects(runtime.ingest(event('movie.scene.direction.requested'), 'tenant-b'), error => error instanceof MovieRuntimeError && error.code === 'TENANT_SCOPE_MISMATCH');
});

test('bounds a failed continuity check to one regeneration', async () => {
  const runtime = new MovieEventRuntime({ service: 'avatarx-brain', maxRegenerations: 1 });
  const retry = await runtime.ingest(event('movie.continuity.evaluated', { data: { passed: false, regenerationAttempt: 0 } }), 'tenant-a');
  const stop = await runtime.ingest(event('movie.continuity.evaluated', { id: crypto.randomUUID(), data: { passed: false, regenerationAttempt: 1 } }), 'tenant-a');
  assert.deepEqual(retry.emitted, ['movie.shot.regeneration.requested']);
  assert.deepEqual(stop.emitted, ['movie.approval.required']);
});

test('avatarx-brain dead-letters repeatedly failing publications', async () => {
  const store = new InMemoryMovieEventStore();
  const runtime = new MovieEventRuntime({ service: 'avatarx-brain', store });
  const result = await runtime.ingest(event('movie.scene.direction.requested'), 'tenant-a');
  if (!result.emitted.length) return assert.equal(store.outbox.size, 0);
  const output = [...store.outbox.values()][0].event;
  await store.failOutbox('tenant-a', output.id, new Error('offline'), 2);
  const failed = await store.failOutbox('tenant-a', output.id, new Error('offline'), 2);
  assert.equal(failed.status, 'dead_letter');
});

test('avatarx-brain retrieves tenant-scoped movie events with filters', async () => {
  const store = new InMemoryMovieEventStore();
  const runtime = new MovieEventRuntime({
    service: 'avatarx-brain',
    store,
  });

  const base = event('movie.scene.direction.requested');

  await runtime.ingest(base, 'tenant-a');

  await runtime.ingest(
    {
      ...base,
      id: crypto.randomUUID(),
      projectId: 'movie-b',
      runId: 'run-b',
      occurredAt: new Date(
        Date.parse(base.occurredAt) + 1000
      ).toISOString(),
    },
    'tenant-a',
  );

  const all = await runtime.getEvents({
    tenantId: 'tenant-a',
  });

  assert.equal(all.length, 2);

  const project = await runtime.getEvents({
    tenantId: 'tenant-a',
    projectId: 'movie-b',
  });

  assert.equal(project.length, 1);
  assert.equal(project[0].projectId, 'movie-b');

  const run = await runtime.getEvents({
    tenantId: 'tenant-a',
    runId: 'run-a',
  });

  assert.equal(run.length, 1);
  assert.equal(run[0].runId, 'run-a');

  const limited = await runtime.getEvents({
    tenantId: 'tenant-a',
    limit: 1,
  });

  assert.equal(limited.length, 1);
  assert.equal(limited[0].projectId, 'movie-b');
});

test('avatarx-brain movie event retrieval validates tenant and limit', async () => {
  const runtime = new MovieEventRuntime({
    service: 'avatarx-brain',
    store: new InMemoryMovieEventStore(),
  });

  await assert.rejects(
    runtime.getEvents({
      tenantId: '',
    }),
    error =>
      error instanceof MovieRuntimeError &&
      error.code === 'TENANT_REQUIRED',
  );

  await assert.rejects(
    runtime.getEvents({
      tenantId: 'tenant-a',
      limit: 0,
    }),
    error =>
      error instanceof MovieRuntimeError &&
      error.code === 'INVALID_EVENT_LIMIT',
  );

  await assert.rejects(
    runtime.getEvents({
      tenantId: 'tenant-a',
      limit: 101,
    }),
    error =>
      error instanceof MovieRuntimeError &&
      error.code === 'INVALID_EVENT_LIMIT',
  );
});
