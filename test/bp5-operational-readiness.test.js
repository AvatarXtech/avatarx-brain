import test from "node:test";
import assert from "node:assert/strict";

import {
  createBrainOperationalReadiness
} from "../src/operational-readiness.js";

test(
  "Brain fails closed without durable workflow storage",
  () => {
    const readiness =
      createBrainOperationalReadiness();

    assert.equal(
      readiness.evaluate({
        workflowStoreReady: false
      }).state,
      "BLOCKED"
    );
  }
);

test(
  "Brain fails closed without escalation authority",
  () => {
    const readiness =
      createBrainOperationalReadiness();

    assert.equal(
      readiness.evaluate({
        escalationAuthorityReady: false
      }).failClosed,
      true
    );
  }
);

test(
  "Brain degrades when recovery is unhealthy",
  () => {
    const readiness =
      createBrainOperationalReadiness();

    assert.equal(
      readiness.evaluate({
        recoveryHealthy: false
      }).state,
      "DEGRADED"
    );
  }
);

test(
  "Brain reports READY only with durable orchestration controls",
  () => {
    const readiness =
      createBrainOperationalReadiness();

    assert.equal(
      readiness.evaluate().ready,
      true
    );
  }
);