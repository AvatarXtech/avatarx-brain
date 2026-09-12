const LEVELS =
  new Set([
    "WORKFLOW",
    "SERVICE",
    "PLATFORM",
    "HUMAN"
  ]);

function required(
  value,
  name
) {
  if (
    typeof value !== "string" ||
    value.trim() === ""
  ) {
    throw new TypeError(
      `${name} is required`
    );
  }

  return value.trim();
}

export function createEscalationAuthority({
  now =
    () =>
      new Date().toISOString()
} = {}) {

  function evaluate({
    tenantId,
    workflowId,
    sourceService,
    reasonCode,
    reliabilityState,
    retryCount = 0,
    approvalRequired = false
  }) {

    tenantId =
      required(
        tenantId,
        "tenantId"
      );

    workflowId =
      required(
        workflowId,
        "workflowId"
      );

    sourceService =
      required(
        sourceService,
        "sourceService"
      );

    reasonCode =
      required(
        reasonCode,
        "reasonCode"
      );

    let level =
      "WORKFLOW";

    let targetService =
      sourceService;

    let requiresHuman =
      false;

    if (
      approvalRequired === true
    ) {
      level =
        "HUMAN";

      targetService =
        "avatarx-agents";

      requiresHuman =
        true;
    }
    else if (
      reliabilityState ===
        "RECOVERY_REQUIRED"
    ) {
      level =
        "SERVICE";

      targetService =
        sourceService;
    }
    else if (
      reliabilityState ===
        "BLOCKED" ||
      retryCount >= 3
    ) {
      level =
        "PLATFORM";

      targetService =
        "avatarx-brain";
    }

    if (!LEVELS.has(level)) {
      throw new Error(
        "invalid escalation level"
      );
    }

    return Object.freeze({
      tenantId,
      workflowId,
      sourceService,
      targetService,
      level,
      reasonCode,
      requiresHuman,
      requestedAt:
        now()
    });
  }

  return Object.freeze({
    evaluate
  });
}