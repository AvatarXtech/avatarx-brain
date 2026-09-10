const SERVICE = "avatarx-brain";
const SCHEMA_VERSION = "1";

export const BRAIN_OPERATIONS = Object.freeze([
  "brain.reason",
  "brain.plan",
  "brain.decide",
  "brain.orchestrate"
]);

const CAPABILITY_TARGET = Object.freeze({
  intelligence: "avatarx-intelligence",
  agents: "avatarx-agents",
  memory: "avatarx-memory",
  knowledge: "avatarx-knowledge"
});

export class BrainCoreError extends Error {
  constructor(status, code, message, retryable = false) {
    super(message);
    this.name = "BrainCoreError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function requiredString(value, field) {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    throw new BrainCoreError(
      400,
      "VALIDATION_ERROR",
      `${field} is required`
    );
  }

  return value.trim();
}

function optionalString(value, field) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    throw new BrainCoreError(
      400,
      "VALIDATION_ERROR",
      `${field} must be a non-empty string`
    );
  }

  return value.trim();
}

export function validateBrainCoreRequest(
  input,
  authenticatedTenant
) {
  if (!authenticatedTenant) {
    throw new BrainCoreError(
      401,
      "AUTHENTICATION_ERROR",
      "authenticated tenant is required"
    );
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BrainCoreError(
      400,
      "VALIDATION_ERROR",
      "request body must be an object"
    );
  }

  if (input.schemaVersion !== SCHEMA_VERSION) {
    throw new BrainCoreError(
      400,
      "VALIDATION_ERROR",
      `schemaVersion must be ${SCHEMA_VERSION}`
    );
  }

  const request = {
    ...input,

    requestId:
      requiredString(
        input.requestId,
        "requestId"
      ),

    traceId:
      requiredString(
        input.traceId,
        "traceId"
      ),

    correlationId:
      requiredString(
        input.correlationId,
        "correlationId"
      ),

    workflowId:
      requiredString(
        input.workflowId,
        "workflowId"
      ),

    sessionId:
      requiredString(
        input.sessionId,
        "sessionId"
      ),

    tenantId:
      requiredString(
        input.tenantId,
        "tenantId"
      ),

    sourceService:
      requiredString(
        input.sourceService,
        "sourceService"
      ),

    targetService:
      requiredString(
        input.targetService,
        "targetService"
      ),

    operation:
      requiredString(
        input.operation,
        "operation"
      ),

    actorId:
      optionalString(
        input.actorId,
        "actorId"
      ),

    projectId:
      optionalString(
        input.projectId,
        "projectId"
      ),

    idempotencyKey:
      optionalString(
        input.idempotencyKey,
        "idempotencyKey"
      )
  };

  if (request.tenantId !== authenticatedTenant) {
    throw new BrainCoreError(
      403,
      "AUTHORIZATION_ERROR",
      "request tenant does not match authenticated tenant"
    );
  }

  if (request.targetService !== SERVICE) {
    throw new BrainCoreError(
      422,
      "WORKFLOW_ERROR",
      "request targetService must be avatarx-brain"
    );
  }

  if (!BRAIN_OPERATIONS.includes(request.operation)) {
    throw new BrainCoreError(
      422,
      "WORKFLOW_ERROR",
      `unsupported Brain operation: ${request.operation}`
    );
  }

  if (
    typeof request.timestamp !== "string" ||
    Number.isNaN(Date.parse(request.timestamp))
  ) {
    throw new BrainCoreError(
      400,
      "VALIDATION_ERROR",
      "timestamp must be ISO-8601"
    );
  }

  if (
    request.deadlineAt !== undefined &&
    request.deadlineAt !== null
  ) {
    if (
      typeof request.deadlineAt !== "string" ||
      Number.isNaN(Date.parse(request.deadlineAt))
    ) {
      throw new BrainCoreError(
        400,
        "VALIDATION_ERROR",
        "deadlineAt must be ISO-8601"
      );
    }

    if (Date.parse(request.deadlineAt) <= Date.now()) {
      throw new BrainCoreError(
        408,
        "TIMEOUT",
        "request deadline has already elapsed",
        true
      );
    }
  }

  if (
    !request.payload ||
    typeof request.payload !== "object" ||
    Array.isArray(request.payload)
  ) {
    throw new BrainCoreError(
      400,
      "VALIDATION_ERROR",
      "payload must be an object"
    );
  }

  return Object.freeze(request);
}

function requestedCapabilities(payload) {
  const values = [];

  if (
    typeof payload.capability === "string" &&
    payload.capability.trim()
  ) {
    values.push(payload.capability.trim());
  }

  if (Array.isArray(payload.requiredCapabilities)) {
    for (const item of payload.requiredCapabilities) {
      if (
        typeof item === "string" &&
        item.trim()
      ) {
        values.push(item.trim());
      }
    }
  }

  return [...new Set(values)];
}

function actionForCapability(capability, request) {
  const normalized =
    String(capability)
      .trim()
      .toLowerCase();

  const target =
    CAPABILITY_TARGET[normalized];

  if (!target) {
    throw new BrainCoreError(
      422,
      "WORKFLOW_ERROR",
      `unsupported downstream capability: ${capability}`
    );
  }

  return {
    actionId:
      `${request.requestId}:${normalized}`,

    capability: normalized,

    targetService: target,

    status: "PLANNED",

    requestContext: {
      requestId: request.requestId,
      traceId: request.traceId,
      correlationId: request.correlationId,
      workflowId: request.workflowId,
      sessionId: request.sessionId,
      tenantId: request.tenantId
    }
  };
}

export function createBrainDecision(request) {
  const goal =
    typeof request.payload.goal === "string"
      ? request.payload.goal.trim()
      : "";

  const capabilities =
    requestedCapabilities(request.payload);

  switch (request.operation) {
    case "brain.reason":
      return {
        decisionType: "REASONING",
        goal,
        summary:
          goal
            ? `Reasoning accepted for goal: ${goal}`
            : "Reasoning request accepted.",
        actions: []
      };

    case "brain.plan":
      return {
        decisionType: "PLAN",
        goal,
        summary:
          capabilities.length
            ? "Execution plan created."
            : "No downstream capability required.",
        actions:
          capabilities.map(
            (capability) =>
              actionForCapability(
                capability,
                request
              )
          )
      };

    case "brain.decide": {
      if (capabilities.length > 1) {
        throw new BrainCoreError(
          422,
          "WORKFLOW_ERROR",
          "brain.decide accepts at most one downstream capability"
        );
      }

      return {
        decisionType: "DECISION",
        goal,
        summary:
          capabilities.length === 1
            ? "Downstream capability selected."
            : "Brain can complete this decision without downstream delegation.",
        actions:
          capabilities.map(
            (capability) =>
              actionForCapability(
                capability,
                request
              )
          )
      };
    }

    case "brain.orchestrate":
      return {
        decisionType: "ORCHESTRATION",
        goal,
        summary:
          capabilities.length
            ? "Bounded orchestration plan created."
            : "No downstream orchestration required.",
        actions:
          capabilities.map(
            (capability) =>
              actionForCapability(
                capability,
                request
              )
          )
      };

    default:
      throw new BrainCoreError(
        422,
        "WORKFLOW_ERROR",
        "unsupported Brain operation"
      );
  }
}

function buildResult(request, decision) {
  return {
    schemaVersion: SCHEMA_VERSION,
    requestId: request.requestId,
    traceId: request.traceId,
    correlationId: request.correlationId,
    workflowId: request.workflowId,
    sourceService: SERVICE,
    status: "SUCCEEDED",
    timestamp: new Date().toISOString(),
    result: {
      decision
    },
    warnings: [],
    errors: [],
    usage: null,
    metadata: {
      sessionId: request.sessionId,
      tenantId: request.tenantId,
      actorId: request.actorId ?? null,
      projectId: request.projectId ?? null,
      operation: request.operation
    }
  };
}

export class InMemoryBrainCoreStore {
  constructor() {
    this.byRequest = new Map();
    this.byIdempotency = new Map();
  }

  requestKey(tenantId, requestId) {
    return `${tenantId}:${requestId}`;
  }

  idempotencyKey(request) {
    if (!request.idempotencyKey) {
      return null;
    }

    return [
      request.tenantId,
      request.workflowId,
      request.idempotencyKey
    ].join(":");
  }

  async findExisting(request) {
    const byRequest =
      this.byRequest.get(
        this.requestKey(
          request.tenantId,
          request.requestId
        )
      );

    if (byRequest) {
      return byRequest;
    }

    const key =
      this.idempotencyKey(request);

    if (!key) {
      return null;
    }

    return this.byIdempotency.get(key) ?? null;
  }

  async save(request, result) {
    const record = {
      request,
      result,
      createdAt: new Date().toISOString()
    };

    this.byRequest.set(
      this.requestKey(
        request.tenantId,
        request.requestId
      ),
      record
    );

    const key =
      this.idempotencyKey(request);

    if (key) {
      this.byIdempotency.set(
        key,
        record
      );
    }

    return record;
  }

  async ready() {
    return true;
  }
}

export class PostgresBrainCoreStore {
  constructor(pool) {
    this.pool = pool;
  }

  async findExisting(request) {
    const result =
      await this.pool.query(
        `
        SELECT
          request_envelope,
          result_envelope
        FROM brain_core_executions
        WHERE
          tenant_id = $1
          AND (
            request_id = $2
            OR (
              $3::text IS NOT NULL
              AND workflow_id = $4
              AND idempotency_key = $3
            )
          )
        ORDER BY created_at ASC
        LIMIT 1
        `,
        [
          request.tenantId,
          request.requestId,
          request.idempotencyKey,
          request.workflowId
        ]
      );

    if (!result.rowCount) {
      return null;
    }

    return {
      request:
        result.rows[0].request_envelope,
      result:
        result.rows[0].result_envelope
    };
  }

  async save(request, result) {
    await this.pool.query(
      `
      INSERT INTO brain_core_executions (
        tenant_id,
        request_id,
        workflow_id,
        session_id,
        trace_id,
        correlation_id,
        operation,
        idempotency_key,
        request_envelope,
        result_envelope,
        status
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
      )
      ON CONFLICT (
        tenant_id,
        request_id
      )
      DO NOTHING
      `,
      [
        request.tenantId,
        request.requestId,
        request.workflowId,
        request.sessionId,
        request.traceId,
        request.correlationId,
        request.operation,
        request.idempotencyKey,
        request,
        result,
        result.status
      ]
    );

    return {
      request,
      result
    };
  }

  async ready() {
    await this.pool.query("SELECT 1");
    return true;
  }
}

async function configuredStore(
  store,
  env
) {
  if (store) {
    return store;
  }

  const production =
    env.NODE_ENV === "production" ||
    env.PERSISTENCE_BACKEND === "postgres";

  if (!production) {
    return new InMemoryBrainCoreStore();
  }

  const connectionString =
    env.BRAIN_DATABASE_URL ||
    env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "BRAIN_DATABASE_URL is required for Brain core production persistence"
    );
  }

  const { Pool } =
    await import("pg");

  return new PostgresBrainCoreStore(
    new Pool({
      connectionString
    })
  );
}

export class BrainCoreRuntime {
  constructor({
    store = new InMemoryBrainCoreStore()
  } = {}) {
    this.store = store;
  }

  async execute(input, authenticatedTenant) {
    const request =
      validateBrainCoreRequest(
        input,
        authenticatedTenant
      );

    const existing =
      await this.store.findExisting(
        request
      );

    if (existing) {
      return {
        duplicate: true,
        result: existing.result
      };
    }

    const decision =
      createBrainDecision(request);

    const result =
      buildResult(
        request,
        decision
      );

    await this.store.save(
      request,
      result
    );

    return {
      duplicate: false,
      result
    };
  }

  async ready() {
    return this.store.ready();
  }
}

export function createBrainCoreEndpoint({
  store,
  env = process.env
} = {}) {
  let runtime;

  const getRuntime = async () => {
    if (!runtime) {
      runtime =
        new BrainCoreRuntime({
          store:
            await configuredStore(
              store,
              env
            )
        });
    }

    return runtime;
  };

  return async function handle({
    req,
    res,
    url,
    bodyText,
    tenantId,
    send,
    fail
  }) {
    if (
      req.method === "GET" &&
      url.pathname === "/ready/ai-core"
    ) {
      try {
        await (
          await getRuntime()
        ).ready();

        send(
          res,
          200,
          {
            status: "ready",
            service: SERVICE,
            schemaVersion:
              SCHEMA_VERSION
          }
        );
      } catch {
        fail(
          res,
          503,
          "DEPENDENCY_ERROR",
          "Brain core persistence is unavailable"
        );
      }

      return true;
    }

    if (
      req.method !== "POST" ||
      url.pathname !== "/v1/ai/core"
    ) {
      return false;
    }

    try {
      let payload;

      try {
        payload =
          JSON.parse(
            bodyText || "{}"
          );
      } catch {
        throw new BrainCoreError(
          400,
          "VALIDATION_ERROR",
          "request body must be valid JSON"
        );
      }

      const execution =
        await (
          await getRuntime()
        ).execute(
          payload,
          tenantId
        );

      send(
        res,
        execution.duplicate
          ? 200
          : 202,
        {
          duplicate:
            execution.duplicate,
          ...execution.result
        }
      );
    } catch (error) {
      fail(
        res,
        error.status ?? 500,
        error.code ?? "INTERNAL_ERROR",
        error.status
          ? error.message
          : "Brain core execution failed"
      );
    }

    return true;
  };
}