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

test('avatarx-brain retrieves tenant-scoped consumed and emitted movie events with filters', async () => {
  const store = new InMemoryMovieEventStore();

  const runtime =
    new MovieEventRuntime({
      service: 'avatarx-brain',
      store,
    });

  const base =
    event(
      'movie.scene.direction.requested',
    );

  await runtime.ingest(
    base,
    'tenant-a',
  );

  await runtime.ingest(
    {
      ...base,

      id:
        crypto.randomUUID(),

      projectId:
        'movie-b',

      runId:
        'run-b',

      occurredAt:
        new Date(
          Date.parse(base.occurredAt) +
            1000,
        ).toISOString(),
    },
    'tenant-a',
  );

  const all =
    await runtime.getEvents({
      tenantId:
        'tenant-a',
    });

  assert.equal(
    all.length,
    4,
  );

  assert.equal(
    all.filter(
      item =>
        item.type ===
        'movie.scene.direction.requested',
    ).length,
    2,
  );

  assert.equal(
    all.filter(
      item =>
        item.type ===
        'movie.workflow.requested',
    ).length,
    2,
  );

  const project =
    await runtime.getEvents({
      tenantId:
        'tenant-a',

      projectId:
        'movie-b',
    });

  assert.equal(
    project.length,
    2,
  );

  assert.ok(
    project.every(
      item =>
        item.projectId ===
        'movie-b',
    ),
  );

  assert.deepEqual(
    new Set(
      project.map(
        item => item.type,
      ),
    ),
    new Set([
      'movie.scene.direction.requested',
      'movie.workflow.requested',
    ]),
  );

  const run =
    await runtime.getEvents({
      tenantId:
        'tenant-a',

      runId:
        'run-a',
    });

  assert.equal(
    run.length,
    2,
  );

  assert.ok(
    run.every(
      item =>
        item.runId ===
        'run-a',
    ),
  );

  assert.deepEqual(
    new Set(
      run.map(
        item => item.type,
      ),
    ),
    new Set([
      'movie.scene.direction.requested',
      'movie.workflow.requested',
    ]),
  );

  const limited =
    await runtime.getEvents({
      tenantId:
        'tenant-a',

      limit:
        1,
    });

  assert.equal(
    limited.length,
    1,
  );

  assert.equal(
    limited[0].tenantId,
    'tenant-a',
  );
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

test('avatarx-brain retrieval includes emitted workflow events', async () => {
  const store =
    new InMemoryMovieEventStore();

  const runtime =
    new MovieEventRuntime({
      service: 'avatarx-brain',
      store,
    });

  const input =
    event(
      'movie.scene.direction.requested',
      {
        id:
          crypto.randomUUID(),

        projectId:
          'movie-connected',

        runId:
          'run-connected',

        traceId:
          'trace-connected',

        correlationId:
          'scene-connected',
      },
    );

  const result =
    await runtime.ingest(
      input,
      'tenant-a',
    );

  assert.deepEqual(
    result.emitted,
    [
      'movie.workflow.requested',
    ],
  );

  const events =
    await runtime.getEvents({
      tenantId:
        'tenant-a',

      projectId:
        'movie-connected',

      runId:
        'run-connected',

      limit:
        10,
    });

  assert.equal(
    events.length,
    2,
  );

  assert.deepEqual(
    new Set(
      events.map(
        item => item.type,
      ),
    ),
    new Set([
      'movie.scene.direction.requested',
      'movie.workflow.requested',
    ]),
  );

  const workflow =
    events.find(
      item =>
        item.type ===
        'movie.workflow.requested',
    );

  assert.ok(
    workflow,
  );

  assert.equal(
    workflow.source,
    'avatarx-brain',
  );

  assert.equal(
    workflow.tenantId,
    input.tenantId,
  );

  assert.equal(
    workflow.projectId,
    input.projectId,
  );

  assert.equal(
    workflow.runId,
    input.runId,
  );

  assert.equal(
    workflow.traceId,
    input.traceId,
  );

  assert.equal(
    workflow.correlationId,
    input.correlationId,
  );

  assert.equal(
    workflow.causationId,
    input.id,
  );

  assert.equal(
    workflow.data.sourceEventType,
    'movie.scene.direction.requested',
  );
});
