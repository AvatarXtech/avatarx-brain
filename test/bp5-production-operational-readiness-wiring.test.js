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
  "Brain managed runtime composes operational readiness",
  () => {
    assert.match(
      runtime,
      /createBrainOperationalReadiness/
    );

    assert.match(
      runtime,
      /operationalReadinessAuthority/
    );
  }
);

test(
  "Brain readiness checks durable workflow and orchestration stores",
  () => {
    assert.match(
      runtime,
      /workflowStoreReady/
    );

    assert.match(
      runtime,
      /orchestrationStoreReady/
    );

    assert.match(
      runtime,
      /await this\.workflowStore/
    );

    assert.match(
      runtime,
      /await this\.orchestrationStore/
    );
  }
);

test(
  "Brain readiness includes escalation authority",
  () => {
    assert.match(
      runtime,
      /escalationAuthorityReady/
    );

    assert.match(
      runtime,
      /this\.escalationAuthority/
    );
  }
);

test(
  "Brain readiness preserves recovery health",
  () => {
    assert.match(
      runtime,
      /recoveryHealthy/
    );

    assert.match(
      runtime,
      /this\.coreRuntime/
    );
  }
);

test(
  "Brain readiness fails closed",
  () => {
    assert.match(
      runtime,
      /readiness\.ready/
    );

    assert.match(
      runtime,
      /BRAIN_OPERATIONAL_READINESS_FAILED/
    );

    assert.match(
      runtime,
      /throw error/
    );
  }
);

test(
  "Brain preserves managed readiness endpoint",
  () => {
    assert.match(
      runtime,
      /\/ready\/ai-orchestration/
    );

    assert.match(
      runtime,
      /DEPENDENCY_ERROR/
    );
  }
);