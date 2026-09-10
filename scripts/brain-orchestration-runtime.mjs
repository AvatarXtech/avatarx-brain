import {
  createHash,
  createHmac
} from "node:crypto";

import {
  BrainCoreRuntime,
  InMemoryBrainCoreStore,
  PostgresBrainCoreStore
} from "./brain-core-runtime.mjs";

const SERVICE = "avatarx-brain";

export const DOWNSTREAM_OPERATION = Object.freeze({
  "avatarx-intelligence": "intelligence.route",
  "avatarx-agents": "agents.execute",
  "avatarx-memory": "memory.context",
  "avatarx-knowledge": "knowledge.retrieve"
});

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_REQUEST_TIMEOUT_MS = 10000;

export class BrainOrchestrationError extends Error {
  constructor(
    status,
    code,
    message,
    retryable = false,
    details = null
  ) {
    super(message);

    this.name = "BrainOrchestrationError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export class DownstreamExecutionError extends Error {
  constructor({
    code = "DEPENDENCY_ERROR",
    message = "Downstream execution failed",
    retryable = false,
    status = 502,
    details = null
  } = {}) {
    super(message);

    this.name = "DownstreamExecutionError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
    this.details = details;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  );
}

function remainingDeadlineMs(
  deadlineAt
) {
  if (!deadlineAt) {
    return Number.POSITIVE_INFINITY;
  }

  return (
    Date.parse(deadlineAt) -
    Date.now()
  );
}

function canonicalError(error) {
  return {
    code:
      error?.code ??
      "DEPENDENCY_ERROR",

    message:
      String(
        error?.message ??
        "Downstream execution failed"
      ),

    retryable:
      error?.retryable === true,

    details:
      error?.details ?? null
  };
}

function finalStatus(actions) {
  if (!actions.length) {
    return "SUCCEEDED";
  }

  const statuses =
    actions.map(
      (action) => action.status
    );

  if (
    statuses.every(
      (status) =>
        status === "SUCCEEDED"
    )
  ) {
    return "SUCCEEDED";
  }

  if (
    statuses.every(
      (status) =>
        status === "CANCELLED"
    )
  ) {
    return "CANCELLED";
  }

  if (
    statuses.every(
      (status) =>
        status === "TIMED_OUT"
    )
  ) {
    return "TIMED_OUT";
  }

  if (
    statuses.some(
      (status) =>
        status === "SUCCEEDED"
    )
  ) {
    return "PARTIAL";
  }

  return "FAILED";
}

export function createDownstreamRequest(
  request,
  action,
  attempt
) {
  const operation =
    DOWNSTREAM_OPERATION[
      action.targetService
    ];

  if (!operation) {
    throw new BrainOrchestrationError(
      422,
      "WORKFLOW_ERROR",
      `No canonical downstream operation for ${action.targetService}`
    );
  }

  return {
    schemaVersion: "1",

    requestId:
      `${request.requestId}:${action.actionId}:${attempt}`,

    traceId:
      request.traceId,

    correlationId:
      request.correlationId,

    workflowId:
      request.workflowId,

    sessionId:
      request.sessionId,

    tenantId:
      request.tenantId,

    actorId:
      request.actorId ?? null,

    projectId:
      request.projectId ?? null,

    sourceService:
      SERVICE,

    targetService:
      action.targetService,

    operation,

    timestamp:
      nowIso(),

    deadlineAt:
      request.deadlineAt ?? null,

    idempotencyKey:
      [
        request.idempotencyKey ??
          request.requestId,
        action.actionId
      ].join(":"),

    payload: {
      goal:
        request.payload?.goal ?? null,

      capability:
        action.capability,

      parentOperation:
        request.operation,

      parentRequestId:
        request.requestId,

      parentPayload:
        request.payload ?? {}
    },

    metadata: {
      causationId:
        request.requestId,

      attempt
    }
  };
}

export class InMemoryBrainOrchestrationStore {
  constructor() {
    this.byRequest =
      new Map();

    this.byIdempotency =
      new Map();
  }

  requestKey(request) {
    return [
      request.tenantId,
      request.requestId
    ].join(":");
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
    const direct =
      this.byRequest.get(
        this.requestKey(request)
      );

    if (direct) {
      return direct;
    }

    const key =
      this.idempotencyKey(
        request
      );

    if (!key) {
      return null;
    }

    return (
      this.byIdempotency.get(
        key
      ) ?? null
    );
  }

  async save(
    request,
    result,
    lineage
  ) {
    const record = {
      request,
      result,
      lineage,
      createdAt:
        nowIso()
    };

    this.byRequest.set(
      this.requestKey(request),
      record
    );

    const key =
      this.idempotencyKey(
        request
      );

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

export class PostgresBrainOrchestrationStore {
  constructor(pool) {
    this.pool = pool;
  }

  async findExisting(request) {
    const result =
      await this.pool.query(
        `
        SELECT
          request_envelope,
          result_envelope,
          action_lineage
        FROM brain_orchestration_runs
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
        result.rows[0]
          .request_envelope,

      result:
        result.rows[0]
          .result_envelope,

      lineage:
        result.rows[0]
          .action_lineage
    };
  }

  async save(
    request,
    result,
    lineage
  ) {
    await this.pool.query(
      `
      INSERT INTO brain_orchestration_runs (
        tenant_id,
        request_id,
        workflow_id,
        trace_id,
        correlation_id,
        idempotency_key,
        status,
        request_envelope,
        result_envelope,
        action_lineage
      )
      VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,$10
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
        request.traceId,
        request.correlationId,
        request.idempotencyKey,
        result.status,
        request,
        result,
        lineage
      ]
    );

    return {
      request,
      result,
      lineage
    };
  }

  async ready() {
    await this.pool.query(
      "SELECT 1"
    );

    return true;
  }
}

function serviceUrlMap(env) {
  return {
    "avatarx-intelligence":
      env.INTELLIGENCE_SERVICE_URL,

    "avatarx-agents":
      env.AGENTS_SERVICE_URL,

    "avatarx-memory":
      env.MEMORY_SERVICE_URL,

    "avatarx-knowledge":
      env.KNOWLEDGE_SERVICE_URL
  };
}

export class HttpBrainDownstreamTransport {
  constructor({
    env = process.env,
    fetchImpl = globalThis.fetch,
    requestTimeoutMs =
      DEFAULT_REQUEST_TIMEOUT_MS
  } = {}) {
    if (
      typeof fetchImpl !==
      "function"
    ) {
      throw new Error(
        "fetch implementation is required"
      );
    }

    this.env = env;
    this.fetchImpl =
      fetchImpl;

    this.requestTimeoutMs =
      requestTimeoutMs;

    this.urls =
      serviceUrlMap(env);
  }

  async invoke(
    downstreamRequest,
    {
      signal
    } = {}
  ) {
    const base =
      this.urls[
        downstreamRequest
          .targetService
      ];

    if (!base) {
      throw new DownstreamExecutionError({
        code:
          "DEPENDENCY_ERROR",

        message:
          `Service URL missing for ${downstreamRequest.targetService}`,

        retryable:
          false,

        status:
          503
      });
    }

    const url =
      new URL(
        "/v1/ai/core",
        base
      );

    const body =
      JSON.stringify(
        downstreamRequest
      );

    const deadlineMs =
      remainingDeadlineMs(
        downstreamRequest.deadlineAt
      );

    if (deadlineMs <= 0) {
      throw new DownstreamExecutionError({
        code:
          "TIMEOUT",

        message:
          "Workflow deadline elapsed before downstream request",

        retryable:
          false,

        status:
          408
      });
    }

    const timeoutMs =
      Math.max(
        1,
        Math.min(
          this.requestTimeoutMs,
          Number.isFinite(
            deadlineMs
          )
            ? deadlineMs
            : this.requestTimeoutMs
        )
      );

    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () =>
          controller.abort(
            new Error(
              "downstream timeout"
            )
          ),
        timeoutMs
      );

    const abortFromParent = () =>
      controller.abort(
        signal?.reason ??
          new Error(
            "workflow cancelled"
          )
      );

    if (signal) {
      if (signal.aborted) {
        abortFromParent();
      } else {
        signal.addEventListener(
          "abort",
          abortFromParent,
          {
            once: true
          }
        );
      }
    }

    const headers = {
      "content-type":
        "application/json",

      "x-tenant-id":
        downstreamRequest
          .tenantId,

      "x-avatarx-service":
        SERVICE
    };

    const secret =
      this.env
        .SERVICE_AUTH_SECRET;

    if (secret) {
      const timestamp =
        String(Date.now());

      const digest =
        createHash("sha256")
          .update(body)
          .digest("hex");

      const signature =
        createHmac(
          "sha256",
          secret
        )
          .update(
            [
              "POST",
              url.pathname,
              timestamp,
              digest
            ].join("\n")
          )
          .digest("hex");

      headers[
        "x-avatarx-timestamp"
      ] = timestamp;

      headers[
        "x-avatarx-signature"
      ] = signature;
    } else if (
      this.env.NODE_ENV ===
      "production"
    ) {
      clearTimeout(timer);

      throw new DownstreamExecutionError({
        code:
          "AUTHENTICATION_ERROR",

        message:
          "SERVICE_AUTH_SECRET is required for production downstream calls",

        retryable:
          false,

        status:
          500
      });
    }

    try {
      const response =
        await this.fetchImpl(
          url,
          {
            method: "POST",
            headers,
            body,
            signal:
              controller.signal
          }
        );

      let payload = null;

      try {
        payload =
          await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const code =
          payload?.error?.code ??
          (
            response.status ===
            429
              ? "RATE_LIMIT"
              : "DEPENDENCY_ERROR"
          );

        const retryable =
          response.status === 429 ||
          response.status >= 500;

        throw new DownstreamExecutionError({
          code,

          message:
            payload?.error?.message ??
            `Downstream HTTP ${response.status}`,

          retryable,

          status:
            response.status,

          details: {
            targetService:
              downstreamRequest
                .targetService
          }
        });
      }

      return payload;
    } catch (error) {
      if (
        error instanceof
        DownstreamExecutionError
      ) {
        throw error;
      }

      if (
        controller.signal
          .aborted
      ) {
        if (signal?.aborted) {
          throw new DownstreamExecutionError({
            code:
              "CANCELLED",

            message:
              "Workflow cancelled",

            retryable:
              false,

            status:
              499
          });
        }

        throw new DownstreamExecutionError({
          code:
            "TIMEOUT",

          message:
            "Downstream request timed out",

          retryable:
            true,

          status:
            408
        });
      }

      throw new DownstreamExecutionError({
        code:
          "DEPENDENCY_ERROR",

        message:
          String(
            error?.message ??
            "Downstream transport failed"
          ),

        retryable:
          true,

        status:
          502
      });
    } finally {
      clearTimeout(timer);

      if (signal) {
        signal.removeEventListener(
          "abort",
          abortFromParent
        );
      }
    }
  }
}

export class BrainOrchestrationRuntime {
  constructor({
    coreRuntime =
      new BrainCoreRuntime(),

    store =
      new InMemoryBrainOrchestrationStore(),

    transport,

    maxAttempts =
      DEFAULT_MAX_ATTEMPTS,

    baseBackoffMs =
      100,

    sleepImpl =
      sleep
  } = {}) {
    if (!transport) {
      throw new Error(
        "Brain orchestration transport is required"
      );
    }

    if (
      !Number.isInteger(
        maxAttempts
      ) ||
      maxAttempts < 1 ||
      maxAttempts > 10
    ) {
      throw new Error(
        "maxAttempts must be from 1 to 10"
      );
    }

    this.coreRuntime =
      coreRuntime;

    this.store =
      store;

    this.transport =
      transport;

    this.maxAttempts =
      maxAttempts;

    this.baseBackoffMs =
      baseBackoffMs;

    this.sleep =
      sleepImpl;
  }

  async executeAction(
    request,
    action,
    {
      signal
    } = {}
  ) {
    const attempts = [];

    for (
      let attempt = 1;
      attempt <=
        this.maxAttempts;
      attempt += 1
    ) {
      if (signal?.aborted) {
        return {
          actionId:
            action.actionId,

          capability:
            action.capability,

          targetService:
            action.targetService,

          status:
            "CANCELLED",

          attempts,

          error: {
            code:
              "CANCELLED",

            message:
              "Workflow cancelled",

            retryable:
              false
          }
        };
      }

      if (
        remainingDeadlineMs(
          request.deadlineAt
        ) <= 0
      ) {
        return {
          actionId:
            action.actionId,

          capability:
            action.capability,

          targetService:
            action.targetService,

          status:
            "TIMED_OUT",

          attempts,

          error: {
            code:
              "TIMEOUT",

            message:
              "Workflow deadline elapsed",

            retryable:
              false
          }
        };
      }

      const downstreamRequest =
        createDownstreamRequest(
          request,
          action,
          attempt
        );

      const startedAt =
        nowIso();

      try {
        const response =
          await this.transport.invoke(
            downstreamRequest,
            {
              signal
            }
          );

        const completedAt =
          nowIso();

        attempts.push({
          attempt,
          startedAt,
          completedAt,
          status:
            "SUCCEEDED"
        });

        return {
          actionId:
            action.actionId,

          capability:
            action.capability,

          targetService:
            action.targetService,

          operation:
            downstreamRequest
              .operation,

          requestId:
            downstreamRequest
              .requestId,

          status:
            "SUCCEEDED",

          attempts,

          response
        };
      } catch (error) {
        const canonical =
          canonicalError(
            error
          );

        attempts.push({
          attempt,
          startedAt,
          completedAt:
            nowIso(),

          status:
            canonical.code ===
            "TIMEOUT"
              ? "TIMED_OUT"
              : canonical.code ===
                "CANCELLED"
                ? "CANCELLED"
                : "FAILED",

          error:
            canonical
        });

        if (
          canonical.code ===
          "CANCELLED"
        ) {
          return {
            actionId:
              action.actionId,

            capability:
              action.capability,

            targetService:
              action.targetService,

            operation:
              downstreamRequest
                .operation,

            status:
              "CANCELLED",

            attempts,

            error:
              canonical
          };
        }

        const deadlineExpired =
          remainingDeadlineMs(
            request.deadlineAt
          ) <= 0;

        if (
          canonical.code ===
            "TIMEOUT" &&
          deadlineExpired
        ) {
          return {
            actionId:
              action.actionId,

            capability:
              action.capability,

            targetService:
              action.targetService,

            operation:
              downstreamRequest
                .operation,

            status:
              "TIMED_OUT",

            attempts,

            error:
              canonical
          };
        }

        if (
          !canonical.retryable ||
          attempt >=
            this.maxAttempts
        ) {
          return {
            actionId:
              action.actionId,

            capability:
              action.capability,

            targetService:
              action.targetService,

            operation:
              downstreamRequest
                .operation,

            status:
              canonical.code ===
              "TIMEOUT"
                ? "TIMED_OUT"
                : "FAILED",

            attempts,

            error:
              canonical
          };
        }

        const backoffMs =
          Math.min(
            5000,
            this.baseBackoffMs *
              2 ** (
                attempt - 1
              )
          );

        if (
          remainingDeadlineMs(
            request.deadlineAt
          ) <= backoffMs
        ) {
          return {
            actionId:
              action.actionId,

            capability:
              action.capability,

            targetService:
              action.targetService,

            operation:
              downstreamRequest
                .operation,

            status:
              "TIMED_OUT",

            attempts,

            error: {
              code:
                "TIMEOUT",

              message:
                "Insufficient deadline remaining for retry",

              retryable:
                false
            }
          };
        }

        await this.sleep(
          backoffMs
        );
      }
    }

    throw new Error(
      "unreachable orchestration retry state"
    );
  }

  async execute(
    input,
    authenticatedTenant,
    {
      signal
    } = {}
  ) {
    const core =
      await this.coreRuntime.execute(
        input,
        authenticatedTenant
      );

    const request = {
      ...input,
      tenantId:
        authenticatedTenant
    };

    const existing =
      await this.store.findExisting(
        request
      );

    if (existing) {
      return {
        duplicate: true,
        result:
          existing.result,
        lineage:
          existing.lineage
      };
    }

    if (signal?.aborted) {
      const result = {
        ...core.result,
        status:
          "CANCELLED",

        timestamp:
          nowIso(),

        result: {
          ...core.result.result,
          actions: []
        },

        errors: [
          {
            code:
              "CANCELLED",

            message:
              "Workflow cancelled before orchestration",

            retryable:
              false,

            details:
              null
          }
        ]
      };

      await this.store.save(
        request,
        result,
        []
      );

      return {
        duplicate:
          false,
        result,
        lineage: []
      };
    }

    const plannedActions =
      core.result
        ?.result
        ?.decision
        ?.actions ?? [];

    const lineage = [];

    for (
      const action of
      plannedActions
    ) {
      if (signal?.aborted) {
        lineage.push({
          actionId:
            action.actionId,

          capability:
            action.capability,

          targetService:
            action.targetService,

          status:
            "CANCELLED",

          attempts: [],

          error: {
            code:
              "CANCELLED",

            message:
              "Workflow cancelled",

            retryable:
              false
          }
        });

        continue;
      }

      const executed =
        await this.executeAction(
          request,
          action,
          {
            signal
          }
        );

      lineage.push(
        executed
      );
    }

    const status =
      finalStatus(
        lineage
      );

    const errors =
      lineage
        .filter(
          (action) =>
            action.error
        )
        .map(
          (action) => ({
            ...action.error,

            details: {
              ...(action.error
                ?.details ?? {}),

              actionId:
                action.actionId,

              targetService:
                action.targetService
            }
          })
        );

    const result = {
      ...core.result,

      status,

      timestamp:
        nowIso(),

      result: {
        ...core.result.result,

        orchestration: {
          planned:
            plannedActions.length,

          completed:
            lineage.filter(
              (action) =>
                action.status ===
                "SUCCEEDED"
            ).length,

          failed:
            lineage.filter(
              (action) =>
                action.status ===
                "FAILED"
            ).length,

          cancelled:
            lineage.filter(
              (action) =>
                action.status ===
                "CANCELLED"
            ).length,

          timedOut:
            lineage.filter(
              (action) =>
                action.status ===
                "TIMED_OUT"
            ).length,

          actions:
            lineage
        }
      },

      errors
    };

    await this.store.save(
      request,
      result,
      lineage
    );

    return {
      duplicate:
        false,
      result,
      lineage
    };
  }

  async ready() {
    await this.store.ready();

    if (
      typeof this.coreRuntime
        .ready === "function"
    ) {
      await this.coreRuntime.ready();
    }

    return true;
  }
}

async function configuredRuntime(
  {
    env,
    transport,
    store,
    coreRuntime,
    maxAttempts,
    baseBackoffMs,
    sleepImpl
  }
) {
  let resolvedCore =
    coreRuntime;

  let resolvedStore =
    store;

  const production =
    env.NODE_ENV ===
      "production" ||
    env.PERSISTENCE_BACKEND ===
      "postgres";

  if (
    !resolvedCore ||
    !resolvedStore
  ) {
    if (production) {
      const connectionString =
        env.BRAIN_DATABASE_URL ||
        env.DATABASE_URL;

      if (!connectionString) {
        throw new Error(
          "BRAIN_DATABASE_URL is required for Brain orchestration production persistence"
        );
      }

      const {
        Pool
      } =
        await import("pg");

      const pool =
        new Pool({
          connectionString
        });

      resolvedCore ??=
        new BrainCoreRuntime({
          store:
            new PostgresBrainCoreStore(
              pool
            )
        });

      resolvedStore ??=
        new PostgresBrainOrchestrationStore(
          pool
        );
    } else {
      resolvedCore ??=
        new BrainCoreRuntime({
          store:
            new InMemoryBrainCoreStore()
        });

      resolvedStore ??=
        new InMemoryBrainOrchestrationStore();
    }
  }

  return new BrainOrchestrationRuntime({
    coreRuntime:
      resolvedCore,

    store:
      resolvedStore,

    transport:
      transport ??
      new HttpBrainDownstreamTransport({
        env
      }),

    maxAttempts,

    baseBackoffMs,

    sleepImpl
  });
}

export function createBrainOrchestrationEndpoint({
  env = process.env,
  transport,
  store,
  coreRuntime,
  maxAttempts =
    Number(
      env.BRAIN_ORCHESTRATION_MAX_ATTEMPTS ??
      DEFAULT_MAX_ATTEMPTS
    ),
  baseBackoffMs =
    Number(
      env.BRAIN_ORCHESTRATION_BACKOFF_MS ??
      100
    ),
  sleepImpl
} = {}) {
  let runtime;

  const getRuntime =
    async () => {
      if (!runtime) {
        runtime =
          await configuredRuntime({
            env,
            transport,
            store,
            coreRuntime,
            maxAttempts,
            baseBackoffMs,
            sleepImpl
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
    fail,
    signal
  }) {
    if (
      req.method === "GET" &&
      url.pathname ===
        "/ready/ai-orchestration"
    ) {
      try {
        await (
          await getRuntime()
        ).ready();

        send(
          res,
          200,
          {
            status:
              "ready",

            service:
              SERVICE,

            runtime:
              "orchestration"
          }
        );
      } catch {
        fail(
          res,
          503,
          "DEPENDENCY_ERROR",
          "Brain orchestration persistence is unavailable"
        );
      }

      return true;
    }

    if (
      req.method !== "POST" ||
      url.pathname !==
        "/v1/ai/orchestrate"
    ) {
      return false;
    }

    try {
      let input;

      try {
        input =
          JSON.parse(
            bodyText || "{}"
          );
      } catch {
        throw new BrainOrchestrationError(
          400,
          "VALIDATION_ERROR",
          "request body must be valid JSON"
        );
      }

      const execution =
        await (
          await getRuntime()
        ).execute(
          input,
          tenantId,
          {
            signal
          }
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
        error.code ??
          "INTERNAL_ERROR",
        error.status
          ? error.message
          : "Brain orchestration failed"
      );
    }

    return true;
  };
}