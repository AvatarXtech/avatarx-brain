import test from "node:test";
import assert from "node:assert/strict";

import {
  createBrainFaultHarness
} from "../scripts/bp6-brain-fault-harness.mjs";

function run(fault) {
  return createBrainFaultHarness()
    .run({
      scenarioId:
        `bp6-brain-${fault}`,

      targetService:
        "avatarx-brain",

      tenantId:
        "tenant-brain",

      fault
    });
}

test(
  "Brain blocks workflow-store failure",
  () => {
    const result =
      run(
        "WORKFLOW_STORE_UNAVAILABLE"
      );

    assert.equal(
      result.observedOutcome,
      "FAIL_CLOSED"
    );

    assert.equal(
      result.readiness.reasonCode,
      "DURABLE_ORCHESTRATION_UNAVAILABLE"
    );
  }
);

test(
  "Brain blocks orchestration-store failure",
  () => {
    const result =
      run(
        "ORCHESTRATION_STORE_UNAVAILABLE"
      );

    assert.equal(
      result.failClosedVerified,
      true
    );
  }
);

test(
  "Brain blocks escalation-authority failure",
  () => {
    const result =
      run(
        "ESCALATION_AUTHORITY_UNAVAILABLE"
      );

    assert.equal(
      result.readiness.reasonCode,
      "ESCALATION_AUTHORITY_UNAVAILABLE"
    );

    assert.equal(
      result.observedOutcome,
      "FAIL_CLOSED"
    );
  }
);

test(
  "Brain degrades recovery failure",
  () => {
    const result =
      run(
        "RECOVERY_DEGRADED"
      );

    assert.equal(
      result.observedOutcome,
      "DEGRADE"
    );

    assert.equal(
      result.readiness.reasonCode,
      "RECOVERY_DEGRADED"
    );
  }
);

test(
  "Brain rejects cross-service fault",
  () => {
    assert.throws(
      () =>
        createBrainFaultHarness()
          .run({
            scenarioId: "cross",
            targetService:
              "avatarx-agents",
            tenantId: "tenant-a",
            fault:
              "RECOVERY_DEGRADED"
          }),
      /targetService/
    );
  }
);