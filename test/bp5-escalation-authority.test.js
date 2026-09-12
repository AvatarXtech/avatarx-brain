import test from "node:test";
import assert from "node:assert/strict";

import {
  createEscalationAuthority
} from "../src/escalation-authority.js";

test(
  "Brain escalates approval-required workflow to human control",
  () => {
    const authority =
      createEscalationAuthority();

    const result =
      authority.evaluate({
        tenantId:
          "tenant-a",

        workflowId:
          "workflow-1",

        sourceService:
          "avatarx-neuron",

        reasonCode:
          "APPROVAL_REQUIRED",

        approvalRequired:
          true
      });

    assert.equal(
      result.level,
      "HUMAN"
    );

    assert.equal(
      result.targetService,
      "avatarx-agents"
    );

    assert.equal(
      result.requiresHuman,
      true
    );
  }
);

test(
  "Brain escalates repeated failure to platform",
  () => {
    const authority =
      createEscalationAuthority();

    const result =
      authority.evaluate({
        tenantId:
          "tenant-a",

        workflowId:
          "workflow-1",

        sourceService:
          "avatarx-neuron",

        reasonCode:
          "RETRY_EXHAUSTED",

        retryCount:
          3
      });

    assert.equal(
      result.level,
      "PLATFORM"
    );
  }
);

test(
  "Brain sends recovery-required state to service recovery",
  () => {
    const authority =
      createEscalationAuthority();

    const result =
      authority.evaluate({
        tenantId:
          "tenant-a",

        workflowId:
          "workflow-1",

        sourceService:
          "avatarx-neuron",

        reasonCode:
          "PROVIDER_UNHEALTHY",

        reliabilityState:
          "RECOVERY_REQUIRED"
      });

    assert.equal(
      result.level,
      "SERVICE"
    );
  }
);