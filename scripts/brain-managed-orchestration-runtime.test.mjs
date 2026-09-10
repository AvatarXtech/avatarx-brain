import test from "node:test";
import assert from "node:assert/strict";

import {
  ManagedBrainOrchestrationRuntime,
  InMemoryBrainManagedStore,
  createManagedBrainEndpoint
} from "./brain-managed-orchestration-runtime.mjs";

import {
  BrainOrchestrationRuntime,
  InMemoryBrainOrchestrationStore
} from "./brain-orchestration-runtime.mjs";

function request(overrides = {}) {
  return {
    schemaVersion: "1",
    requestId: "req-1",
    traceId: "trace-1",
    correlationId: "corr-1",
    workflowId: "workflow-1",
    sessionId: "session-1",
    tenantId: "tenant-a",
    actorId: "actor-a",
    projectId: "project-a",
    sourceService: "avatarx-ai-director",
    targetService: "avatarx-brain",
    operation: "brain.orchestrate",
    timestamp: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 60000).toISOString(),
    idempotencyKey: "idem-1",
    payload: {
      goal: "Complete workflow",
      requiredCapabilities: [
        "knowledge",
        "memory"
      ]
    },
    metadata: {},
    ...overrides
  };
}

function coreResult() {
  return {
    schemaVersion: "1",
    requestId: "req-1",
    traceId: "trace-1",
    correlationId: "corr-1",
    workflowId: "workflow-1",
    sourceService: "avatarx-brain",
    status: "SUCCEEDED",
    timestamp: new Date().toISOString(),
    result: {
      decision: {
        decisionType: "ORCHESTRATION",
        actions: [
          {
            actionId: "action-knowledge",
            capability: "knowledge",
            targetService: "avatarx-knowledge",
            status: "PLANNED"
          },
          {
            actionId: "action-memory",
            capability: "memory",
            targetService: "avatarx-memory",
            status: "PLANNED"
          }
        ]
      }
    },
    warnings: [],
    errors: [],
    usage: null,
    metadata: {}
  };
}

class FakeCoreRuntime {
  async execute() {
    return {
      duplicate: false,
      result: structuredClone(coreResult())
    };
  }

  async ready() {
    return true;
  }
}

class FakeTransport {
  constructor() {
    this.calls = [];
  }

  async invoke(value) {
    this.calls.push(value);

    return {
      schemaVersion: "1",
      requestId: value.requestId,
      traceId: value.traceId,
      correlationId: value.correlationId,
      workflowId: value.workflowId,
      sourceService: value.targetService,
      status: "SUCCEEDED",
      timestamp: new Date().toISOString(),
      result: {
        ok: true
      },
      warnings: [],
      errors: [],
      usage: null,
      metadata: {}
    };
  }
}

function createRuntime({
  store = new InMemoryBrainManagedStore(),
  transport = new FakeTransport(),
  owner = "worker-a"
} = {}) {
  const coreRuntime = new FakeCoreRuntime();

  const orchestrationStore =
    new InMemoryBrainOrchestrationStore();

  const executor =
    new BrainOrchestrationRuntime({
      coreRuntime,
      store: orchestrationStore,
      transport,
      maxAttempts: 2,
      baseBackoffMs: 1,
      sleepImpl: async () => {}
    });

  const managed =
    new ManagedBrainOrchestrationRuntime({
      coreRuntime,
      executor,
      orchestrationStore,
      workflowStore: store,
      owner,
      leaseTtlMs: 1000,
      staleRunMs: 2000
    });

  return {
    managed,
    store,
    transport
  };
}

test("managed production path executes and checkpoints actions", async () => {
  const {
    managed,
    transport
  } = createRuntime();

  const execution =
    await managed.execute(
      request(),
      "tenant-a"
    );

  assert.equal(
    execution.result.status,
    "SUCCEEDED"
  );

  assert.equal(
    transport.calls.length,
    2
  );

  const inspection =
    await managed.inspect(
      "tenant-a",
      "workflow-1"
    );

  assert.equal(
    inspection.workflow.executionState,
    "COMPLETED"
  );

  assert.equal(
    inspection.checkpoints.length,
    2
  );

  assert.equal(
    inspection.checkpoints.every(
      (item) =>
        item.status === "SUCCEEDED"
    ),
    true
  );
});

test("inspection fails closed across tenants", async () => {
  const {
    managed
  } = createRuntime();

  await managed.execute(
    request(),
    "tenant-a"
  );

  await assert.rejects(
    () =>
      managed.inspect(
        "tenant-b",
        "workflow-1"
      ),
    (error) =>
      error.status === 404
  );
});

test("active workflow lease blocks concurrent Brain worker", async () => {
  const store =
    new InMemoryBrainManagedStore();

  const lease =
    await store.acquireLease({
      tenantId: "tenant-a",
      workflowId: "workflow-1",
      owner: "worker-a",
      ttlMs: 1000
    });

  assert.ok(lease);

  const {
    managed
  } = createRuntime({
    store,
    owner: "worker-b"
  });

  await assert.rejects(
    () =>
      managed.execute(
        request(),
        "tenant-a"
      ),
    (error) =>
      error.status === 409 &&
      error.retryable === true
  );
});

test("workflow leases are tenant isolated", async () => {
  const store =
    new InMemoryBrainManagedStore();

  const first =
    await store.acquireLease({
      tenantId: "tenant-a",
      workflowId: "workflow-1",
      owner: "worker-a",
      ttlMs: 1000
    });

  const second =
    await store.acquireLease({
      tenantId: "tenant-b",
      workflowId: "workflow-1",
      owner: "worker-b",
      ttlMs: 1000
    });

  assert.ok(first);
  assert.ok(second);
});

test("resume skips already successful action checkpoint", async () => {
  const store =
    new InMemoryBrainManagedStore();

  const transport =
    new FakeTransport();

  const {
    managed
  } = createRuntime({
    store,
    transport
  });

  const input = request();
  const result = coreResult();

  await store.createWorkflow(
    input,
    result
  );

  const firstAction =
    result.result.decision.actions[0];

  await store.saveCheckpoint(
    "tenant-a",
    "workflow-1",
    0,
    firstAction,
    {
      actionId: firstAction.actionId,
      capability: firstAction.capability,
      targetService: firstAction.targetService,
      operation: "knowledge.retrieve",
      requestId: "previous-request",
      status: "SUCCEEDED",
      attempts: [
        {
          attempt: 1,
          status: "SUCCEEDED"
        }
      ],
      response: {
        status: "SUCCEEDED"
      }
    }
  );

  await store.markRecoveryRequired(
    "tenant-a",
    "workflow-1"
  );

  const resumed =
    await managed.resume(
      "tenant-a",
      "workflow-1"
    );

  assert.equal(
    resumed.resumed,
    true
  );

  assert.equal(
    transport.calls.length,
    1
  );

  assert.equal(
    transport.calls[0].targetService,
    "avatarx-memory"
  );

  assert.equal(
    resumed.result.status,
    "SUCCEEDED"
  );
});

test("restart with new runtime instance resumes durable checkpoint state", async () => {
  const store =
    new InMemoryBrainManagedStore();

  const input = request();
  const result = coreResult();

  await store.createWorkflow(
    input,
    result
  );

  const firstAction =
    result.result.decision.actions[0];

  await store.saveCheckpoint(
    "tenant-a",
    "workflow-1",
    0,
    firstAction,
    {
      actionId: firstAction.actionId,
      capability: firstAction.capability,
      targetService: firstAction.targetService,
      status: "SUCCEEDED",
      attempts: [
        {
          attempt: 1,
          status: "SUCCEEDED"
        }
      ],
      response: {
        status: "SUCCEEDED"
      }
    }
  );

  await store.markRecoveryRequired(
    "tenant-a",
    "workflow-1"
  );

  const transport =
    new FakeTransport();

  const restarted =
    createRuntime({
      store,
      transport,
      owner: "restarted-worker"
    });

  const resumed =
    await restarted.managed.resume(
      "tenant-a",
      "workflow-1"
    );

  assert.equal(
    resumed.resumed,
    true
  );

  assert.equal(
    transport.calls.length,
    1
  );

  assert.equal(
    resumed.result.status,
    "SUCCEEDED"
  );
});

test("persisted cancellation prevents unfinished actions from running", async () => {
  const store =
    new InMemoryBrainManagedStore();

  const transport =
    new FakeTransport();

  const {
    managed
  } = createRuntime({
    store,
    transport
  });

  await store.createWorkflow(
    request(),
    coreResult()
  );

  await store.requestCancellation(
    "tenant-a",
    "workflow-1"
  );

  await store.markRecoveryRequired(
    "tenant-a",
    "workflow-1"
  );

  const execution =
    await managed.resume(
      "tenant-a",
      "workflow-1"
    );

  assert.equal(
    execution.result.status,
    "CANCELLED"
  );

  assert.equal(
    transport.calls.length,
    0
  );

  assert.equal(
    execution.lineage.every(
      (action) =>
        action.status === "CANCELLED"
    ),
    true
  );
});

test("completed workflow cannot be retroactively cancelled", async () => {
  const {
    managed
  } = createRuntime();

  await managed.execute(
    request(),
    "tenant-a"
  );

  const result =
    await managed.cancel(
      "tenant-a",
      "workflow-1"
    );

  assert.equal(
    result.executionState,
    "COMPLETED"
  );

  assert.equal(
    result.cancellationRequested,
    false
  );
});

test("stale unlocked RUNNING workflow becomes RECOVERY_REQUIRED", async () => {
  const store =
    new InMemoryBrainManagedStore();

  await store.createWorkflow(
    request(),
    coreResult()
  );

  await store.setRunning(
    "tenant-a",
    "workflow-1"
  );

  const workflow =
    await store.getWorkflow(
      "tenant-a",
      "workflow-1"
    );

  workflow.lastHeartbeatAt =
    new Date(
      Date.now() - 10000
    ).toISOString();

  const {
    managed
  } = createRuntime({
    store
  });

  const scan =
    await managed.scanRecovery(
      "tenant-a"
    );

  assert.equal(
    scan.recoverable,
    1
  );

  const updated =
    await store.getWorkflow(
      "tenant-a",
      "workflow-1"
    );

  assert.equal(
    updated.executionState,
    "RECOVERY_REQUIRED"
  );
});

test("stale workflow with active lease is not recovered", async () => {
  const store =
    new InMemoryBrainManagedStore();

  await store.createWorkflow(
    request(),
    coreResult()
  );

  await store.setRunning(
    "tenant-a",
    "workflow-1"
  );

  const workflow =
    await store.getWorkflow(
      "tenant-a",
      "workflow-1"
    );

  workflow.lastHeartbeatAt =
    new Date(
      Date.now() - 10000
    ).toISOString();

  await store.acquireLease({
    tenantId: "tenant-a",
    workflowId: "workflow-1",
    owner: "active-worker",
    ttlMs: 60000
  });

  const {
    managed
  } = createRuntime({
    store
  });

  const scan =
    await managed.scanRecovery(
      "tenant-a"
    );

  assert.equal(
    scan.recoverable,
    0
  );
});

test("recovery scanning is tenant isolated", async () => {
  const store =
    new InMemoryBrainManagedStore();

  await store.createWorkflow(
    request({
      tenantId: "tenant-b"
    }),
    coreResult()
  );

  await store.setRunning(
    "tenant-b",
    "workflow-1"
  );

  const workflow =
    await store.getWorkflow(
      "tenant-b",
      "workflow-1"
    );

  workflow.lastHeartbeatAt =
    new Date(
      Date.now() - 10000
    ).toISOString();

  const {
    managed
  } = createRuntime({
    store
  });

  const scan =
    await managed.scanRecovery(
      "tenant-a"
    );

  assert.equal(
    scan.recoverable,
    0
  );

  assert.equal(
    (
      await store.getWorkflow(
        "tenant-b",
        "workflow-1"
      )
    ).executionState,
    "RUNNING"
  );
});

test("resume refuses workflow not marked for recovery", async () => {
  const store =
    new InMemoryBrainManagedStore();

  await store.createWorkflow(
    request(),
    coreResult()
  );

  const {
    managed
  } = createRuntime({
    store
  });

  await assert.rejects(
    () =>
      managed.resume(
        "tenant-a",
        "workflow-1"
      ),
    /not RECOVERY_REQUIRED/
  );
});

test("HTTP managed endpoint exposes workflow inspection", async () => {
  const {
    managed
  } = createRuntime();

  await managed.execute(
    request(),
    "tenant-a"
  );

  const endpoint =
    createManagedBrainEndpoint({
      runtime: managed
    });

  let response;

  const handled =
    await endpoint({
      req: {
        method: "GET"
      },
      res: {},
      url: new URL(
        "http://localhost/v1/ai/workflows/workflow-1"
      ),
      bodyText: "",
      tenantId: "tenant-a",
      send(_res, status, body) {
        response = {
          status,
          body
        };
      },
      fail(_res, status, code, message) {
        response = {
          status,
          body: {
            error: {
              code,
              message
            }
          }
        };
      }
    });

  assert.equal(
    handled,
    true
  );

  assert.equal(
    response.status,
    200
  );

  assert.equal(
    response.body.workflow.workflowId,
    "workflow-1"
  );
});

test("HTTP managed endpoint exposes cancellation", async () => {
  const store =
    new InMemoryBrainManagedStore();

  await store.createWorkflow(
    request(),
    coreResult()
  );

  const {
    managed
  } = createRuntime({
    store
  });

  const endpoint =
    createManagedBrainEndpoint({
      runtime: managed
    });

  let response;

  await endpoint({
    req: {
      method: "POST"
    },
    res: {},
    url: new URL(
      "http://localhost/v1/ai/workflows/workflow-1/cancel"
    ),
    bodyText: "",
    tenantId: "tenant-a",
    send(_res, status, body) {
      response = {
        status,
        body
      };
    },
    fail(_res, status, code, message) {
      response = {
        status,
        body: {
          error: {
            code,
            message
          }
        }
      };
    }
  });

  assert.equal(
    response.status,
    202
  );

  assert.equal(
    response.body.cancellationRequested,
    true
  );
});

test("HTTP managed endpoint exposes recovery scanning", async () => {
  const {
    managed
  } = createRuntime();

  const endpoint =
    createManagedBrainEndpoint({
      runtime: managed
    });

  let response;

  await endpoint({
    req: {
      method: "POST"
    },
    res: {},
    url: new URL(
      "http://localhost/v1/ai/recovery/scan"
    ),
    bodyText: "",
    tenantId: "tenant-a",
    send(_res, status, body) {
      response = {
        status,
        body
      };
    },
    fail(_res, status, code, message) {
      response = {
        status,
        body: {
          error: {
            code,
            message
          }
        }
      };
    }
  });

  assert.equal(
    response.status,
    200
  );

  assert.equal(
    response.body.tenantId,
    "tenant-a"
  );
});

test("managed API fails closed when tenant header is absent", async () => {
  const {
    managed
  } = createRuntime();

  const endpoint =
    createManagedBrainEndpoint({
      runtime: managed
    });

  let response;

  const handled =
    await endpoint({
      req: {
        method: "GET"
      },
      res: {},
      url: new URL(
        "http://localhost/v1/ai/workflows/workflow-1"
      ),
      bodyText: "",
      tenantId: undefined,
      send() {},
      fail(_res, status, code, message) {
        response = {
          status,
          code,
          message
        };
      }
    });

  assert.equal(
    handled,
    true
  );

  assert.equal(
    response.status,
    400
  );

  assert.equal(
    response.code,
    "VALIDATION_ERROR"
  );
});