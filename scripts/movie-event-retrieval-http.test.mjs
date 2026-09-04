import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  InMemoryMovieEventStore,
  createMovieRuntimeEndpoint,
} from './movie-pipeline-runtime.mjs';

function createResponse() {
  return {
    statusCode: null,
    body: null,

    writeHead(status) {
      this.statusCode = status;
    },

    end(value) {
      this.body =
        value ? JSON.parse(value) : undefined;
    },
  };
}

function event(overrides = {}) {
  return {
    specversion: '1.1',
    id: crypto.randomUUID(),
    type: 'movie.scene.direction.requested',
    source: 'avatarx-ai-director',

    tenantId: 'tenant-a',
    projectId: 'project-a',
    runId: 'run-a',

    traceId: 'trace-a',
    correlationId: 'correlation-a',

    occurredAt: new Date().toISOString(),

    data: {},

    ...overrides,
  };
}

const send = (res, status, body) => {
  res.writeHead(status);
  res.end(JSON.stringify(body));
};

const fail = (
  res,
  status,
  code,
  message,
) => {
  send(res, status, {
    error: {
      code,
      message,
    },
  });
};

test('GET /v1/movie-events returns tenant-scoped events', async () => {
  const store =
    new InMemoryMovieEventStore();

  const handler =
    createMovieRuntimeEndpoint({
      service: 'avatarx-brain',
      store,
    });

  const first = event();

  const second = event({
    projectId: 'project-b',
    runId: 'run-b',
    occurredAt:
      new Date(
        Date.parse(first.occurredAt) + 1000,
      ).toISOString(),
  });

  await handler({
    req: {
      method: 'POST',
    },
    res: createResponse(),
    url: new URL(
      'http://localhost/v1/movie-events',
    ),
    bodyText: JSON.stringify(first),
    tenantId: 'tenant-a',
    send,
    fail,
  });

  await handler({
    req: {
      method: 'POST',
    },
    res: createResponse(),
    url: new URL(
      'http://localhost/v1/movie-events',
    ),
    bodyText: JSON.stringify(second),
    tenantId: 'tenant-a',
    send,
    fail,
  });

  const res = createResponse();

  const handled =
    await handler({
      req: {
        method: 'GET',
      },
      res,
      url: new URL(
        'http://localhost/v1/movie-events?projectId=project-b&limit=1',
      ),
      bodyText: '',
      tenantId: 'tenant-a',
      send,
      fail,
    });

  assert.equal(
    handled,
    true,
  );

  assert.equal(
    res.statusCode,
    200,
  );

  assert.equal(
    res.body.count,
    1,
  );

  assert.equal(
    res.body.events[0].projectId,
    'project-b',
  );

  assert.equal(
    res.body.events[0].runId,
    'run-b',
  );
});

test('GET /v1/movie-events rejects missing tenant', async () => {
  const handler =
    createMovieRuntimeEndpoint({
      service: 'avatarx-brain',
      store:
        new InMemoryMovieEventStore(),
    });

  const res =
    createResponse();

  await handler({
    req: {
      method: 'GET',
    },
    res,
    url: new URL(
      'http://localhost/v1/movie-events',
    ),
    bodyText: '',
    tenantId: undefined,
    send,
    fail,
  });

  assert.equal(
    res.statusCode,
    401,
  );

  assert.equal(
    res.body.error.code,
    'TENANT_REQUIRED',
  );
});

test('GET /v1/movie-events rejects invalid limit', async () => {
  const handler =
    createMovieRuntimeEndpoint({
      service: 'avatarx-brain',
      store:
        new InMemoryMovieEventStore(),
    });

  const res =
    createResponse();

  await handler({
    req: {
      method: 'GET',
    },
    res,
    url: new URL(
      'http://localhost/v1/movie-events?limit=101',
    ),
    bodyText: '',
    tenantId: 'tenant-a',
    send,
    fail,
  });

  assert.equal(
    res.statusCode,
    400,
  );

  assert.equal(
    res.body.error.code,
    'INVALID_EVENT_LIMIT',
  );
});
