import {
  createBrainOperationalReadiness
} from "../src/operational-readiness.js";

const SERVICE = "avatarx-brain";

const FAULTS = Object.freeze([
  "WORKFLOW_STORE_UNAVAILABLE",
  "ORCHESTRATION_STORE_UNAVAILABLE",
  "ESCALATION_AUTHORITY_UNAVAILABLE",
  "RECOVERY_DEGRADED"
]);

function required(value, name) {
  if (
    typeof value !== "string" ||
    value.trim() === ""
  ) {
    throw new TypeError(`${name} is required`);
  }

  return value.trim();
}

export function createBrainFaultHarness({
  operationalReadiness =
    createBrainOperationalReadiness(),

  now =
    () => new Date().toISOString()
} = {}) {

  function run(input = {}) {
    const scenarioId =
      required(
        input.scenarioId,
        "scenarioId"
      );

    const tenantId =
      required(
        input.tenantId,
        "tenantId"
      );

    if (
      required(
        input.targetService,
        "targetService"
      ) !== SERVICE
    ) {
      throw new TypeError(
        "targetService must be avatarx-brain"
      );
    }

    const fault =
      required(
        input.fault,
        "fault"
      );

    if (!FAULTS.includes(fault)) {
      throw new TypeError(
        `unsupported Brain fault: ${fault}`
      );
    }

    const readiness =
      operationalReadiness.evaluate({
        workflowStoreReady:
          fault !==
          "WORKFLOW_STORE_UNAVAILABLE",

        orchestrationStoreReady:
          fault !==
          "ORCHESTRATION_STORE_UNAVAILABLE",

        escalationAuthorityReady:
          fault !==
          "ESCALATION_AUTHORITY_UNAVAILABLE",

        recoveryHealthy:
          fault !==
          "RECOVERY_DEGRADED"
      });

    return Object.freeze({
      schemaVersion: 1,
      scenarioId,
      targetService: SERVICE,
      tenantId,
      fault,
      readiness,

      observedOutcome:
        readiness.failClosed === true
          ? "FAIL_CLOSED"
          : readiness.ready === false
            ? "DEGRADE"
            : "ALLOW",

      failClosedVerified:
        readiness.failClosed === true,

      evidenceIds:
        Object.freeze([
          `readiness:${readiness.reasonCode}`
        ]),

      observedAt:
        now()
    });
  }

  return Object.freeze({
    run
  });
}

export const BRAIN_BP6_FAULTS =
  FAULTS;