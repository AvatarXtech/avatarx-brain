import test from "node:test";
import assert from "node:assert/strict";

import {
  BrainOrchestrationRuntime,
  DownstreamExecutionError,
  HttpBrainDownstreamTransport,
  InMemoryBrainOrchestrationStore,
  createDownstreamRequest
} from "./brain-orchestration-runtime.mjs";

import {
  BrainCoreRuntime
} from "./brain-core-runtime.mjs";

function request(
  overrides = {}
) {
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
    sourceService:
      "avatarx-ai-director",
    targetService:
      "avatarx-brain",
    operation:
      "brain.orchestrate",
    timestamp:
      new Date().toISOString(),
    deadlineAt:
      new Date(
        Date.now() + 60000
      ).toISOString(),
    idempotencyKey:
      "idem-1",
    payload: {
      goal:
        "Produce scene",
      requiredCapabilities: [
        "knowledge",
        "memory",
        "intelligence",
        "agents"
      ]
    },
    metadata: {},
    ...overrides
  };
}

class FakeTransport {
  constructor(handler) {
    this.handler = handler;
    this.calls = [];
  }

  async invoke(
    downstream,
    options
  ) {
    this.calls.push(
      downstream
    );

    return this.handler(
      downstream,
      options,
      this.calls.length
    );
  }
}

function successfulTransport() {
  return new FakeTransport(
    async (
      downstream
    ) => ({
      schemaVersion: "1",
      requestId:
        downstream.requestId,
      traceId:
        downstream.traceId,
      correlationId:
        downstream.correlationId,
      workflowId:
        downstream.workflowId,
      sourceService:
        downstream.targetService,
      status:
        "SUCCEEDED",
      timestamp:
        new Date().toISOString(),
      result: {
        ok: true
      },
      warnings: [],
      errors: [],
      usage: null,
      metadata: {}
    })
  );
}

test(
  "downstream request preserves workflow identity",
  () => {
    const parent =
      request();

    const action = {
      actionId:
        "action-1",
      capability:
        "knowledge",
      targetService:
        "avatarx-knowledge"
    };

    const downstream =
      createDownstreamRequest(
        parent,
        action,
        1
      );

    assert.equal(
      downstream.traceId,
      parent.traceId
    );

    assert.equal(
      downstream.correlationId,
      parent.correlationId
    );

    assert.equal(
      downstream.workflowId,
      parent.workflowId
    );

    assert.equal(
      downstream.sessionId,
      parent.sessionId
    );

    assert.equal(
      downstream.tenantId,
      parent.tenantId
    );

    assert.equal(
      downstream.operation,
      "knowledge.retrieve"
    );
  }
);

test(
  "successful orchestration executes all planned actions",
  async () => {
    const transport =
      successfulTransport();

    const runtime =
      new BrainOrchestrationRuntime({
        transport,
        sleepImpl:
          async () => {}
      });

    const execution =
      await runtime.execute(
        request(),
        "tenant-a"
      );

    assert.equal(
      execution.result.status,
      "SUCCEEDED"
    );

    assert.equal(
      execution.lineage.length,
      4
    );

    assert.equal(
      transport.calls.length,
      4
    );

    assert.equal(
      execution.result.result
        .orchestration
        .completed,
      4
    );
  }
);

test(
  "canonical downstream operations map to service owners",
  async () => {
    const transport =
      successfulTransport();

    const runtime =
      new BrainOrchestrationRuntime({
        transport,
        sleepImpl:
          async () => {}
      });

    await runtime.execute(
      request(),
      "tenant-a"
    );

    const actual =
      transport.calls.map(
        (call) => [
          call.targetService,
          call.operation
        ]
      );

    assert.deepEqual(
      actual,
      [
        [
          "avatarx-knowledge",
          "knowledge.retrieve"
        ],
        [
          "avatarx-memory",
          "memory.context"
        ],
        [
          "avatarx-intelligence",
          "intelligence.route"
        ],
        [
          "avatarx-agents",
          "agents.execute"
        ]
      ]
    );
  }
);

test(
  "retryable dependency failure retries with bounded backoff",
  async () => {
    let calls = 0;
    const sleeps = [];

    const transport =
      new FakeTransport(
        async (
          downstream
        ) => {
          calls += 1;

          if (calls === 1) {
            throw new DownstreamExecutionError({
              code:
                "DEPENDENCY_ERROR",
              message:
                "temporary",
              retryable:
                true,
              status:
                503
            });
          }

          return {
            status:
              "SUCCEEDED",
            requestId:
              downstream.requestId
          };
        }
      );

    const runtime =
      new BrainOrchestrationRuntime({
        transport,
        maxAttempts:
          3,
        baseBackoffMs:
          5,
        sleepImpl:
          async (ms) =>
            sleeps.push(ms)
      });

    const execution =
      await runtime.execute(
        request({
          payload: {
            goal: "x",
            requiredCapabilities: [
              "knowledge"
            ]
          }
        }),
        "tenant-a"
      );

    assert.equal(
      execution.result.status,
      "SUCCEEDED"
    );

    assert.equal(
      calls,
      2
    );

    assert.deepEqual(
      sleeps,
      [5]
    );

    assert.equal(
      execution.lineage[0]
        .attempts.length,
      2
    );
  }
);

test(
  "non retryable failure executes only once",
  async () => {
    let calls = 0;

    const transport =
      new FakeTransport(
        async () => {
          calls += 1;

          throw new DownstreamExecutionError({
            code:
              "AUTHORIZATION_ERROR",
            message:
              "denied",
            retryable:
              false,
            status:
              403
          });
        }
      );

    const runtime =
      new BrainOrchestrationRuntime({
        transport,
        maxAttempts:
          3,
        sleepImpl:
          async () => {}
      });

    const execution =
      await runtime.execute(
        request({
          payload: {
            requiredCapabilities: [
              "knowledge"
            ]
          }
        }),
        "tenant-a"
      );

    assert.equal(
      calls,
      1
    );

    assert.equal(
      execution.result.status,
      "FAILED"
    );
  }
);

test(
  "mixed success and failure returns PARTIAL",
  async () => {
    const transport =
      new FakeTransport(
        async (
          downstream
        ) => {
          if (
            downstream
              .targetService ===
            "avatarx-memory"
          ) {
            throw new DownstreamExecutionError({
              code:
                "DEPENDENCY_ERROR",
              message:
                "memory unavailable",
              retryable:
                false
            });
          }

          return {
            status:
              "SUCCEEDED"
          };
        }
      );

    const runtime =
      new BrainOrchestrationRuntime({
        transport,
        sleepImpl:
          async () => {}
      });

    const execution =
      await runtime.execute(
        request({
          payload: {
            requiredCapabilities: [
              "knowledge",
              "memory"
            ]
          }
        }),
        "tenant-a"
      );

    assert.equal(
      execution.result.status,
      "PARTIAL"
    );

    assert.equal(
      execution.result.result
        .orchestration
        .completed,
      1
    );

    assert.equal(
      execution.result.result
        .orchestration
        .failed,
      1
    );
  }
);

test(
  "all downstream failures produce FAILED",
  async () => {
    const transport =
      new FakeTransport(
        async () => {
          throw new DownstreamExecutionError({
            code:
              "DEPENDENCY_ERROR",
            message:
              "down",
            retryable:
              false
          });
        }
      );

    const runtime =
      new BrainOrchestrationRuntime({
        transport,
        sleepImpl:
          async () => {}
      });

    const execution =
      await runtime.execute(
        request({
          payload: {
            requiredCapabilities: [
              "knowledge",
              "memory"
            ]
          }
        }),
        "tenant-a"
      );

    assert.equal(
      execution.result.status,
      "FAILED"
    );
  }
);

test(
  "pre-cancelled workflow returns CANCELLED without downstream calls",
  async () => {
    const controller =
      new AbortController();

    controller.abort();

    const transport =
      successfulTransport();

    const runtime =
      new BrainOrchestrationRuntime({
        transport
      });

    const execution =
      await runtime.execute(
        request(),
        "tenant-a",
        {
          signal:
            controller.signal
        }
      );

    assert.equal(
      execution.result.status,
      "CANCELLED"
    );

    assert.equal(
      transport.calls.length,
      0
    );
  }
);

test(
  "elapsed workflow deadline returns canonical timeout",
  async () => {
    const transport =
      new FakeTransport(
        async () => {
          throw new Error(
            "must not execute"
          );
        }
      );

    const coreRuntime = {
      async execute(input) {
        return {
          duplicate: false,
          result: {
            schemaVersion:
              "1",
            requestId:
              input.requestId,
            traceId:
              input.traceId,
            correlationId:
              input.correlationId,
            workflowId:
              input.workflowId,
            sourceService:
              "avatarx-brain",
            status:
              "SUCCEEDED",
            timestamp:
              new Date().toISOString(),
            result: {
              decision: {
                actions: [
                  {
                    actionId:
                      "a",
                    capability:
                      "knowledge",
                    targetService:
                      "avatarx-knowledge"
                  }
                ]
              }
            },
            warnings: [],
            errors: [],
            usage: null,
            metadata: {}
          }
        };
      },

      async ready() {
        return true;
      }
    };

    const runtime =
      new BrainOrchestrationRuntime({
        coreRuntime,
        transport
      });

    const execution =
      await runtime.execute(
        request({
          deadlineAt:
            new Date(
              Date.now() - 100
            ).toISOString()
        }),
        "tenant-a"
      );

    assert.equal(
      execution.result.status,
      "TIMED_OUT"
    );

    assert.equal(
      transport.calls.length,
      0
    );
  }
);

test(
  "orchestration idempotency prevents duplicate downstream execution",
  async () => {
    const transport =
      successfulTransport();

    const store =
      new InMemoryBrainOrchestrationStore();

    const runtime =
      new BrainOrchestrationRuntime({
        transport,
        store,
        sleepImpl:
          async () => {}
      });

    const first =
      await runtime.execute(
        request({
          payload: {
            requiredCapabilities: [
              "knowledge"
            ]
          }
        }),
        "tenant-a"
      );

    const second =
      await runtime.execute(
        request({
          requestId:
            "req-2",
          payload: {
            requiredCapabilities: [
              "knowledge"
            ]
          }
        }),
        "tenant-a"
      );

    assert.equal(
      first.duplicate,
      false
    );

    assert.equal(
      second.duplicate,
      true
    );

    assert.equal(
      transport.calls.length,
      1
    );
  }
);

test(
  "orchestration idempotency remains tenant isolated",
  async () => {
    const transport =
      successfulTransport();

    const runtime =
      new BrainOrchestrationRuntime({
        transport,
        sleepImpl:
          async () => {}
      });

    await runtime.execute(
      request({
        payload: {
          requiredCapabilities: [
            "knowledge"
          ]
        }
      }),
      "tenant-a"
    );

    const second =
      await runtime.execute(
        request({
          requestId:
            "req-2",
          tenantId:
            "tenant-b",
          payload: {
            requiredCapabilities: [
              "knowledge"
            ]
          }
        }),
        "tenant-b"
      );

    assert.equal(
      second.duplicate,
      false
    );

    assert.equal(
      transport.calls.length,
      2
    );
  }
);

test(
  "action lineage records every attempt",
  async () => {
    let count = 0;

    const transport =
      new FakeTransport(
        async () => {
          count += 1;

          if (count < 3) {
            throw new DownstreamExecutionError({
              code:
                "RATE_LIMIT",
              message:
                "slow down",
              retryable:
                true,
              status:
                429
            });
          }

          return {
            status:
              "SUCCEEDED"
          };
        }
      );

    const runtime =
      new BrainOrchestrationRuntime({
        transport,
        maxAttempts:
          3,
        baseBackoffMs:
          1,
        sleepImpl:
          async () => {}
      });

    const execution =
      await runtime.execute(
        request({
          payload: {
            requiredCapabilities: [
              "knowledge"
            ]
          }
        }),
        "tenant-a"
      );

    assert.equal(
      execution.lineage[0]
        .attempts.length,
      3
    );

    assert.deepEqual(
      execution.lineage[0]
        .attempts
        .map(
          (attempt) =>
            attempt.status
        ),
      [
        "FAILED",
        "FAILED",
        "SUCCEEDED"
      ]
    );
  }
);

test(
  "HTTP transport fails closed when target URL is missing",
  async () => {
    const transport =
      new HttpBrainDownstreamTransport({
        env: {},
        fetchImpl:
          async () => {
            throw new Error(
              "must not execute"
            );
          }
      });

    await assert.rejects(
      () =>
        transport.invoke({
          targetService:
            "avatarx-knowledge",
          tenantId:
            "tenant-a"
        }),
      (error) =>
        error.code ===
          "DEPENDENCY_ERROR" &&
        error.retryable ===
          false
    );
  }
);

test(
  "production HTTP transport requires service authentication secret",
  async () => {
    const transport =
      new HttpBrainDownstreamTransport({
        env: {
          NODE_ENV:
            "production",
          KNOWLEDGE_SERVICE_URL:
            "http://knowledge.internal"
        },

        fetchImpl:
          async () => ({
            ok: true,
            status: 200,
            async json() {
              return {};
            }
          })
      });

    await assert.rejects(
      () =>
        transport.invoke({
          targetService:
            "avatarx-knowledge",
          tenantId:
            "tenant-a",
          deadlineAt:
            new Date(
              Date.now() + 10000
            ).toISOString()
        }),
      (error) =>
        error.code ===
          "AUTHENTICATION_ERROR"
    );
  }
);