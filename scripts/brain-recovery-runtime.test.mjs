import test from "node:test";
import assert from "node:assert/strict";

import {
  BrainRecoveryRuntime,
  InMemoryBrainRecoveryStore
} from "./brain-recovery-runtime.mjs";

import {
  validateBrainPhase2Production
} from "./validate-brain-phase2-production.mjs";

function request(
  overrides = {}
) {
  return {
    requestId:
      "req-1",
    workflowId:
      "workflow-1",
    traceId:
      "trace-1",
    tenantId:
      "tenant-a",
    ...overrides
  };
}

test(
  "workflow lease is exclusive while active",
  async () => {
    const store =
      new InMemoryBrainRecoveryStore();

    const a =
      new BrainRecoveryRuntime({
        store,
        leaseTtlMs:
          1000,
        staleRunMs:
          2000,
        owner:
          "worker-a"
      });

    const b =
      new BrainRecoveryRuntime({
        store,
        leaseTtlMs:
          1000,
        staleRunMs:
          2000,
        owner:
          "worker-b"
      });

    await a.acquire(
      "tenant-a",
      "workflow-1"
    );

    await assert.rejects(
      () =>
        b.acquire(
          "tenant-a",
          "workflow-1"
        ),
      (error) =>
        error.status === 409
    );
  }
);

test(
  "lease ownership is tenant isolated",
  async () => {
    const store =
      new InMemoryBrainRecoveryStore();

    const runtime =
      new BrainRecoveryRuntime({
        store,
        leaseTtlMs:
          1000,
        staleRunMs:
          2000
      });

    const a =
      await runtime.acquire(
        "tenant-a",
        "workflow-1"
      );

    const b =
      await runtime.acquire(
        "tenant-b",
        "workflow-1"
      );

    assert.ok(a);
    assert.ok(b);
  }
);

test(
  "released workflow lease can be reacquired",
  async () => {
    const store =
      new InMemoryBrainRecoveryStore();

    const runtime =
      new BrainRecoveryRuntime({
        store,
        leaseTtlMs:
          1000,
        staleRunMs:
          2000
      });

    const first =
      await runtime.acquire(
        "tenant-a",
        "workflow-1"
      );

    assert.equal(
      await runtime.release(
        "tenant-a",
        "workflow-1",
        first.leaseToken
      ),
      true
    );

    const second =
      await runtime.acquire(
        "tenant-a",
        "workflow-1"
      );

    assert.notEqual(
      first.leaseToken,
      second.leaseToken
    );
  }
);

test(
  "heartbeat requires correct lease token",
  async () => {
    const runtime =
      new BrainRecoveryRuntime({
        leaseTtlMs:
          1000,
        staleRunMs:
          2000
      });

    await runtime.acquire(
      "tenant-a",
      "workflow-1"
    );

    await assert.rejects(
      () =>
        runtime.heartbeat(
          "tenant-a",
          "workflow-1",
          "wrong"
        ),
      /lease ownership was lost/
    );
  }
);

test(
  "run transitions RUNNING to COMPLETED",
  async () => {
    const runtime =
      new BrainRecoveryRuntime({
        leaseTtlMs:
          1000,
        staleRunMs:
          2000
      });

    await runtime.begin(
      request()
    );

    const running =
      await runtime.inspect(
        "tenant-a",
        "workflow-1"
      );

    assert.equal(
      running.executionState,
      "RUNNING"
    );

    await runtime.complete(
      "tenant-a",
      "workflow-1"
    );

    const completed =
      await runtime.inspect(
        "tenant-a",
        "workflow-1"
      );

    assert.equal(
      completed.executionState,
      "COMPLETED"
    );

    assert.ok(
      completed.completedAt
    );
  }
);

test(
  "cancellation is durably recorded",
  async () => {
    const runtime =
      new BrainRecoveryRuntime({
        leaseTtlMs:
          1000,
        staleRunMs:
          2000
      });

    await runtime.begin(
      request()
    );

    await runtime.cancel(
      "tenant-a",
      "workflow-1"
    );

    const run =
      await runtime.inspect(
        "tenant-a",
        "workflow-1"
      );

    assert.ok(
      run.cancelledAt
    );

    assert.equal(
      run.executionState,
      "COMPLETED"
    );
  }
);

test(
  "stale running workflows become recovery required",
  async () => {
    const store =
      new InMemoryBrainRecoveryStore();

    const runtime =
      new BrainRecoveryRuntime({
        store,
        leaseTtlMs:
          1000,
        staleRunMs:
          2000
      });

    await runtime.begin(
      request()
    );

    const run =
      await runtime.inspect(
        "tenant-a",
        "workflow-1"
      );

    run.lastHeartbeatAt =
      new Date(
        Date.now() - 10000
      ).toISOString();

    const recovered =
      await runtime.scanRecovery();

    assert.equal(
      recovered.length,
      1
    );

    assert.equal(
      recovered[0]
        .executionState,
      "RECOVERY_REQUIRED"
    );
  }
);

test(
  "fresh running workflow is not marked for recovery",
  async () => {
    const runtime =
      new BrainRecoveryRuntime({
        leaseTtlMs:
          1000,
        staleRunMs:
          5000
      });

    await runtime.begin(
      request()
    );

    const recovered =
      await runtime.scanRecovery();

    assert.equal(
      recovered.length,
      0
    );
  }
);

test(
  "production configuration accepts complete runtime",
  () => {
    const result =
      validateBrainPhase2Production({
        SERVICE_AUTH_SECRET:
          "abcdefghijklmnopqrstuvwxyz1234567890",
        BRAIN_DATABASE_URL:
          "postgresql://brain:secret@db.internal:5432/brain",
        INTELLIGENCE_SERVICE_URL:
          "http://intelligence.internal",
        AGENTS_SERVICE_URL:
          "http://agents.internal",
        MEMORY_SERVICE_URL:
          "http://memory.internal",
        KNOWLEDGE_SERVICE_URL:
          "http://knowledge.internal",
        BRAIN_ORCHESTRATION_MAX_ATTEMPTS:
          "3",
        BRAIN_ORCHESTRATION_BACKOFF_MS:
          "100",
        BRAIN_LEASE_TTL_MS:
          "30000",
        BRAIN_STALE_RUN_MS:
          "60000"
      });

    assert.equal(
      result.valid,
      true
    );

    assert.equal(
      result.downstreamServices,
      4
    );
  }
);

test(
  "production configuration rejects missing service URLs",
  () => {
    assert.throws(
      () =>
        validateBrainPhase2Production({
          SERVICE_AUTH_SECRET:
            "abcdefghijklmnopqrstuvwxyz1234567890",
          BRAIN_DATABASE_URL:
            "postgresql://brain:secret@db.internal:5432/brain"
        }),
      (error) =>
        error.code ===
          "INVALID_BRAIN_PHASE2_CONFIG"
    );
  }
);

test(
  "production configuration rejects unsafe retry configuration",
  () => {
    assert.throws(
      () =>
        validateBrainPhase2Production({
          SERVICE_AUTH_SECRET:
            "abcdefghijklmnopqrstuvwxyz1234567890",
          BRAIN_DATABASE_URL:
            "postgresql://brain:secret@db.internal:5432/brain",
          INTELLIGENCE_SERVICE_URL:
            "http://intelligence.internal",
          AGENTS_SERVICE_URL:
            "http://agents.internal",
          MEMORY_SERVICE_URL:
            "http://memory.internal",
          KNOWLEDGE_SERVICE_URL:
            "http://knowledge.internal",
          BRAIN_ORCHESTRATION_MAX_ATTEMPTS:
            "100"
        }),
      /MAX_ATTEMPTS/
    );
  }
);

test(
  "production configuration requires credentialed Brain database",
  () => {
    assert.throws(
      () =>
        validateBrainPhase2Production({
          SERVICE_AUTH_SECRET:
            "abcdefghijklmnopqrstuvwxyz1234567890",
          BRAIN_DATABASE_URL:
            "postgresql://db.internal/brain",
          INTELLIGENCE_SERVICE_URL:
            "http://intelligence.internal",
          AGENTS_SERVICE_URL:
            "http://agents.internal",
          MEMORY_SERVICE_URL:
            "http://memory.internal",
          KNOWLEDGE_SERVICE_URL:
            "http://knowledge.internal"
        }),
      /BRAIN_DATABASE_URL/
    );
  }
);