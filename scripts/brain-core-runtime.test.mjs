import test from "node:test";
import assert from "node:assert/strict";

import {
  BRAIN_OPERATIONS,
  BrainCoreError,
  BrainCoreRuntime,
  InMemoryBrainCoreStore,
  createBrainDecision,
  validateBrainCoreRequest
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
      "brain.plan",
    timestamp:
      new Date().toISOString(),
    deadlineAt:
      new Date(
        Date.now() + 60000
      ).toISOString(),
    idempotencyKey:
      "idem-1",
    payload: {
      goal: "Create production plan",
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

test(
  "Brain exposes exactly its canonical operations",
  () => {
    assert.deepEqual(
      BRAIN_OPERATIONS,
      [
        "brain.reason",
        "brain.plan",
        "brain.decide",
        "brain.orchestrate"
      ]
    );
  }
);

test(
  "valid request preserves canonical identity",
  () => {
    const value =
      validateBrainCoreRequest(
        request(),
        "tenant-a"
      );

    assert.equal(
      value.requestId,
      "req-1"
    );

    assert.equal(
      value.traceId,
      "trace-1"
    );

    assert.equal(
      value.workflowId,
      "workflow-1"
    );
  }
);

test(
  "tenant mismatch fails closed",
  () => {
    assert.throws(
      () =>
        validateBrainCoreRequest(
          request(),
          "tenant-b"
        ),
      (error) =>
        error instanceof
          BrainCoreError &&
        error.status === 403 &&
        error.code ===
          "AUTHORIZATION_ERROR"
    );
  }
);

test(
  "wrong target service is rejected",
  () => {
    assert.throws(
      () =>
        validateBrainCoreRequest(
          request({
            targetService:
              "avatarx-neuron"
          }),
          "tenant-a"
        ),
      /targetService/
    );
  }
);

test(
  "unsupported Brain operation fails closed",
  () => {
    assert.throws(
      () =>
        validateBrainCoreRequest(
          request({
            operation:
              "neuron.execute"
          }),
          "tenant-a"
        ),
      /unsupported Brain operation/
    );
  }
);

test(
  "expired deadline becomes canonical timeout",
  () => {
    assert.throws(
      () =>
        validateBrainCoreRequest(
          request({
            deadlineAt:
              new Date(
                Date.now() - 1000
              ).toISOString()
          }),
          "tenant-a"
        ),
      (error) =>
        error.code === "TIMEOUT" &&
        error.status === 408
    );
  }
);

test(
  "planning maps canonical capabilities to owners",
  () => {
    const validated =
      validateBrainCoreRequest(
        request(),
        "tenant-a"
      );

    const decision =
      createBrainDecision(
        validated
      );

    assert.deepEqual(
      decision.actions.map(
        (action) =>
          action.targetService
      ),
      [
        "avatarx-knowledge",
        "avatarx-memory",
        "avatarx-intelligence",
        "avatarx-agents"
      ]
    );
  }
);

test(
  "unknown downstream capability is rejected",
  () => {
    const validated =
      validateBrainCoreRequest(
        request({
          payload: {
            requiredCapabilities: [
              "unknown-system"
            ]
          }
        }),
        "tenant-a"
      );

    assert.throws(
      () =>
        createBrainDecision(
          validated
        ),
      /unsupported downstream capability/
    );
  }
);

test(
  "brain.decide allows one downstream capability",
  () => {
    const validated =
      validateBrainCoreRequest(
        request({
          operation:
            "brain.decide",
          payload: {
            capability:
              "intelligence"
          }
        }),
        "tenant-a"
      );

    const decision =
      createBrainDecision(
        validated
      );

    assert.equal(
      decision.actions.length,
      1
    );

    assert.equal(
      decision.actions[0]
        .targetService,
      "avatarx-intelligence"
    );
  }
);

test(
  "brain.decide rejects ambiguous multiple capability choice",
  () => {
    const validated =
      validateBrainCoreRequest(
        request({
          operation:
            "brain.decide",
          payload: {
            requiredCapabilities: [
              "memory",
              "knowledge"
            ]
          }
        }),
        "tenant-a"
      );

    assert.throws(
      () =>
        createBrainDecision(
          validated
        ),
      /at most one/
    );
  }
);

test(
  "runtime produces canonical successful result",
  async () => {
    const runtime =
      new BrainCoreRuntime();

    const execution =
      await runtime.execute(
        request(),
        "tenant-a"
      );

    assert.equal(
      execution.duplicate,
      false
    );

    assert.equal(
      execution.result.status,
      "SUCCEEDED"
    );

    assert.equal(
      execution.result.sourceService,
      "avatarx-brain"
    );

    assert.equal(
      execution.result.traceId,
      "trace-1"
    );
  }
);

test(
  "same request executes exactly once",
  async () => {
    const runtime =
      new BrainCoreRuntime({
        store:
          new InMemoryBrainCoreStore()
      });

    const first =
      await runtime.execute(
        request(),
        "tenant-a"
      );

    const second =
      await runtime.execute(
        request(),
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

    assert.deepEqual(
      second.result,
      first.result
    );
  }
);

test(
  "same tenant workflow and idempotency key deduplicates new request id",
  async () => {
    const runtime =
      new BrainCoreRuntime();

    const first =
      await runtime.execute(
        request(),
        "tenant-a"
      );

    const second =
      await runtime.execute(
        request({
          requestId: "req-2"
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
  }
);

test(
  "idempotency is tenant isolated",
  async () => {
    const runtime =
      new BrainCoreRuntime();

    await runtime.execute(
      request(),
      "tenant-a"
    );

    const second =
      await runtime.execute(
        request({
          requestId: "req-2",
          tenantId: "tenant-b"
        }),
        "tenant-b"
      );

    assert.equal(
      second.duplicate,
      false
    );
  }
);

test(
  "planned actions propagate stable execution identity",
  () => {
    const validated =
      validateBrainCoreRequest(
        request(),
        "tenant-a"
      );

    const decision =
      createBrainDecision(
        validated
      );

    for (
      const action of
      decision.actions
    ) {
      assert.equal(
        action.requestContext
          .requestId,
        "req-1"
      );

      assert.equal(
        action.requestContext
          .traceId,
        "trace-1"
      );

      assert.equal(
        action.requestContext
          .correlationId,
        "corr-1"
      );

      assert.equal(
        action.requestContext
          .workflowId,
        "workflow-1"
      );

      assert.equal(
        action.requestContext
          .tenantId,
        "tenant-a"
      );
    }
  }
);