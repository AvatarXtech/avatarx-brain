export function createBrainOperationalReadiness() {
  function evaluate({
    workflowStoreReady = true,
    orchestrationStoreReady = true,
    escalationAuthorityReady = true,
    recoveryHealthy = true
  } = {}) {

    if (
      workflowStoreReady !== true ||
      orchestrationStoreReady !== true
    ) {
      return Object.freeze({
        state: "BLOCKED",
        ready: false,
        failClosed: true,
        reasonCode:
          "DURABLE_ORCHESTRATION_UNAVAILABLE"
      });
    }

    if (escalationAuthorityReady !== true) {
      return Object.freeze({
        state: "BLOCKED",
        ready: false,
        failClosed: true,
        reasonCode:
          "ESCALATION_AUTHORITY_UNAVAILABLE"
      });
    }

    if (recoveryHealthy !== true) {
      return Object.freeze({
        state: "DEGRADED",
        ready: false,
        failClosed: false,
        reasonCode:
          "RECOVERY_DEGRADED"
      });
    }

    return Object.freeze({
      state: "READY",
      ready: true,
      failClosed: false,
      reasonCode:
        "BRAIN_READY"
    });
  }

  return Object.freeze({
    evaluate
  });
}