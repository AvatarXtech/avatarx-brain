export function validateBrainPhase2Production(
  env = process.env
) {
  const errors = [];

  const urlNames = [
    "INTELLIGENCE_SERVICE_URL",
    "AGENTS_SERVICE_URL",
    "MEMORY_SERVICE_URL",
    "KNOWLEDGE_SERVICE_URL"
  ];

  const secret =
    String(
      env.SERVICE_AUTH_SECRET ??
      ""
    );

  if (
    secret.length < 32
  ) {
    errors.push(
      "SERVICE_AUTH_SECRET must contain at least 32 characters"
    );
  }

  const database =
    env.BRAIN_DATABASE_URL ??
    env.DATABASE_URL;

  try {
    const value =
      new URL(database);

    if (
      ![
        "postgres:",
        "postgresql:"
      ].includes(
        value.protocol
      )
    ) {
      throw new Error();
    }

    if (
      !value.username ||
      !value.password
    ) {
      throw new Error();
    }
  } catch {
    errors.push(
      "BRAIN_DATABASE_URL must be a credentialed PostgreSQL URL"
    );
  }

  for (
    const name of
    urlNames
  ) {
    try {
      const value =
        new URL(
          env[name]
        );

      if (
        ![
          "http:",
          "https:"
        ].includes(
          value.protocol
        )
      ) {
        throw new Error();
      }
    } catch {
      errors.push(
        `${name} must be a valid HTTP(S) URL`
      );
    }
  }

  const attempts =
    Number(
      env.BRAIN_ORCHESTRATION_MAX_ATTEMPTS ??
      3
    );

  if (
    !Number.isInteger(
      attempts
    ) ||
    attempts < 1 ||
    attempts > 10
  ) {
    errors.push(
      "BRAIN_ORCHESTRATION_MAX_ATTEMPTS must be an integer from 1 to 10"
    );
  }

  const backoff =
    Number(
      env.BRAIN_ORCHESTRATION_BACKOFF_MS ??
      100
    );

  if (
    !Number.isFinite(
      backoff
    ) ||
    backoff < 1 ||
    backoff > 60000
  ) {
    errors.push(
      "BRAIN_ORCHESTRATION_BACKOFF_MS must be from 1 to 60000"
    );
  }

  const leaseTtl =
    Number(
      env.BRAIN_LEASE_TTL_MS ??
      30000
    );

  if (
    !Number.isInteger(
      leaseTtl
    ) ||
    leaseTtl < 1000 ||
    leaseTtl > 300000
  ) {
    errors.push(
      "BRAIN_LEASE_TTL_MS must be from 1000 to 300000"
    );
  }

  const stale =
    Number(
      env.BRAIN_STALE_RUN_MS ??
      60000
    );

  if (
    !Number.isInteger(
      stale
    ) ||
    stale < leaseTtl
  ) {
    errors.push(
      "BRAIN_STALE_RUN_MS must be >= BRAIN_LEASE_TTL_MS"
    );
  }

  if (errors.length) {
    const error =
      new Error(
        errors.join("; ")
      );

    error.code =
      "INVALID_BRAIN_PHASE2_CONFIG";

    error.errors =
      errors;

    throw error;
  }

  return {
    valid: true,
    service:
      "avatarx-brain",
    downstreamServices:
      urlNames.length,
    maxAttempts:
      attempts,
    leaseTtlMs:
      leaseTtl,
    staleRunMs:
      stale
  };
}