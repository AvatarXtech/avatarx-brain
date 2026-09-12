import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const runtime =
  fs.readFileSync(
    new URL(
      "../scripts/brain-managed-orchestration-runtime.mjs",
      import.meta.url
    ),
    "utf8"
  );

test(
  "Brain managed runtime imports BP5 escalation authority",
  () => {
    assert.match(
      runtime,
      /createEscalationAuthority/
    );
  }
);

test(
  "Brain managed runtime stores escalation authority",
  () => {
    assert.match(
      runtime,
      /this\.escalationAuthority/
    );
  }
);

test(
  "Brain managed runtime exposes shared escalation evaluator",
  () => {
    assert.match(
      runtime,
      /evaluateEscalation/
    );
  }
);

test(
  "production execute path contains BP5 workflow escalation",
  () => {
    assert.match(
      runtime,
      /BP5_WORKFLOW_ESCALATION/
    );

    assert.match(
      runtime,
      /WAITING_APPROVAL/
    );
  }
);

test(
  "production resume path contains BP5 recovery escalation",
  () => {
    assert.match(
      runtime,
      /BP5_RECOVERY_ESCALATION/
    );

    assert.match(
      runtime,
      /RECOVERY_REQUIRED/
    );
  }
);

test(
  "existing durable orchestration controls remain present",
  () => {
    for (
      const marker of [
        "acquireLease",
        "heartbeatLease",
        "releaseLease",
        "saveCheckpoint",
        "requestCancellation",
        "scanRecovery",
        "runWorkflow"
      ]
    ) {
      assert.match(
        runtime,
        new RegExp(marker)
      );
    }
  }
);