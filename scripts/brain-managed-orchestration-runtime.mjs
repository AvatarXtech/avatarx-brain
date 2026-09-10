import {
  randomUUID
} from "node:crypto";

import {
  BrainCoreRuntime,
  InMemoryBrainCoreStore,
  PostgresBrainCoreStore
} from "./brain-core-runtime.mjs";

import {
  BrainOrchestrationRuntime,
  BrainOrchestrationError,
  HttpBrainDownstreamTransport,
  InMemoryBrainOrchestrationStore,
  PostgresBrainOrchestrationStore
} from "./brain-orchestration-runtime.mjs";

const SERVICE = "avatarx-brain";

const DEFAULT_LEASE_TTL_MS = 30000;
const DEFAULT_STALE_RUN_MS = 60000;

function nowIso() {
  return new Date().toISOString();
}

function workflowKey(
  tenantId,
  workflowId
) {
  return `${tenantId}:${workflowId}`;
}

function canonicalActionError(
  action
) {
  if (!action?.error) {
    return null;
  }

  return {
    ...action.error,

    details: {
      ...(action.error.details ?? {}),

      actionId:
        action.actionId,

      targetService:
        action.targetService
    }
  };
}

function calculateFinalStatus(
  actions
) {
  if (!actions.length) {
    return "SUCCEEDED";
  }

  const statuses =
    actions.map(
      (action) =>
        action.status
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

function normalizeWorkflowRow(
  row
) {
  if (!row) {
    return null;
  }

  return {
    tenantId:
      row.tenantId ??
      row.tenant_id,

    workflowId:
      row.workflowId ??
      row.workflow_id,

    requestId:
      row.requestId ??
      row.request_id,

    traceId:
      row.traceId ??
      row.trace_id,

    correlationId:
      row.correlationId ??
      row.correlation_id,

    idempotencyKey:
      row.idempotencyKey ??
      row.idempotency_key ??
      null,

    requestEnvelope:
      row.requestEnvelope ??
      row.request_envelope,

    coreResultEnvelope:
      row.coreResultEnvelope ??
      row.core_result_envelope,

    executionState:
      row.executionState ??
      row.execution_state,

    terminalStatus:
      row.terminalStatus ??
      row.terminal_status ??
      null,

    cancellationRequested:
      row.cancellationRequested ??
      row.cancellation_requested ??
      false,

    cancellationRequestedAt:
      row.cancellationRequestedAt ??
      row.cancellation_requested_at ??
      null,

    resultEnvelope:
      row.resultEnvelope ??
      row.result_envelope ??
      null,

    startedAt:
      row.startedAt ??
      row.started_at ??
      null,

    lastHeartbeatAt:
      row.lastHeartbeatAt ??
      row.last_heartbeat_at ??
      null,

    completedAt:
      row.completedAt ??
      row.completed_at ??
      null
  };
}

function normalizeCheckpointRow(
  row
) {
  if (!row) {
    return null;
  }

  return {
    tenantId:
      row.tenantId ??
      row.tenant_id,

    workflowId:
      row.workflowId ??
      row.workflow_id,

    actionId:
      row.actionId ??
      row.action_id,

    ordinal:
      Number(
        row.ordinal
      ),

    actionEnvelope:
      row.actionEnvelope ??
      row.action_envelope,

    outcomeEnvelope:
      row.outcomeEnvelope ??
      row.outcome_envelope ??
      null,

    status:
      row.status,

    attempts:
      Number(
        row.attempts ?? 0
      ),

    startedAt:
      row.startedAt ??
      row.started_at ??
      null,

    completedAt:
      row.completedAt ??
      row.completed_at ??
      null
  };
}

export class ManagedBrainError extends Error {
  constructor(
    status,
    code,
    message,
    retryable = false
  ) {
    super(message);

    this.name =
      "ManagedBrainError";

    this.status =
      status;

    this.code =
      code;

    this.retryable =
      retryable;
  }
}

export class InMemoryBrainManagedStore {
  constructor() {
    this.workflows =
      new Map();

    this.checkpoints =
      new Map();

    this.leases =
      new Map();
  }

  checkpointKey(
    tenantId,
    workflowId
  ) {
    return workflowKey(
      tenantId,
      workflowId
    );
  }

  async createWorkflow(
    request,
    coreResult
  ) {
    const key =
      workflowKey(
        request.tenantId,
        request.workflowId
      );

    const existing =
      this.workflows.get(key);

    if (existing) {
      return {
        created: false,
        workflow:
          existing
      };
    }

    const workflow = {
      tenantId:
        request.tenantId,

      workflowId:
        request.workflowId,

      requestId:
        request.requestId,

      traceId:
        request.traceId,

      correlationId:
        request.correlationId,

      idempotencyKey:
        request.idempotencyKey ??
        null,

      requestEnvelope:
        structuredClone(
          request
        ),

      coreResultEnvelope:
        structuredClone(
          coreResult
        ),

      executionState:
        "PENDING",

      terminalStatus:
        null,

      cancellationRequested:
        false,

      cancellationRequestedAt:
        null,

      resultEnvelope:
        null,

      startedAt:
        null,

      lastHeartbeatAt:
        null,

      completedAt:
        null
    };

    this.workflows.set(
      key,
      workflow
    );

    return {
      created: true,
      workflow
    };
  }

  async getWorkflow(
    tenantId,
    workflowId
  ) {
    return (
      this.workflows.get(
        workflowKey(
          tenantId,
          workflowId
        )
      ) ?? null
    );
  }

  async setRunning(
    tenantId,
    workflowId
  ) {
    const workflow =
      await this.getWorkflow(
        tenantId,
        workflowId
      );

    if (!workflow) {
      return null;
    }

    workflow.executionState =
      "RUNNING";

    workflow.startedAt ??=
      nowIso();

    workflow.lastHeartbeatAt =
      nowIso();

    return workflow;
  }

  async heartbeatWorkflow(
    tenantId,
    workflowId
  ) {
    const workflow =
      await this.getWorkflow(
        tenantId,
        workflowId
      );

    if (!workflow) {
      return null;
    }

    workflow.lastHeartbeatAt =
      nowIso();

    return workflow;
  }

  async markRecoveryRequired(
    tenantId,
    workflowId
  ) {
    const workflow =
      await this.getWorkflow(
        tenantId,
        workflowId
      );

    if (!workflow) {
      return null;
    }

    if (
      workflow.executionState !==
      "COMPLETED"
    ) {
      workflow.executionState =
        "RECOVERY_REQUIRED";
    }

    return workflow;
  }

  async completeWorkflow(
    tenantId,
    workflowId,
    status,
    result
  ) {
    const workflow =
      await this.getWorkflow(
        tenantId,
        workflowId
      );

    if (!workflow) {
      return null;
    }

    workflow.executionState =
      "COMPLETED";

    workflow.terminalStatus =
      status;

    workflow.resultEnvelope =
      structuredClone(
        result
      );

    workflow.completedAt =
      nowIso();

    workflow.lastHeartbeatAt =
      nowIso();

    return workflow;
  }

  async requestCancellation(
    tenantId,
    workflowId
  ) {
    const workflow =
      await this.getWorkflow(
        tenantId,
        workflowId
      );

    if (!workflow) {
      return null;
    }

    if (
      workflow.executionState ===
      "COMPLETED"
    ) {
      return workflow;
    }

    workflow.cancellationRequested =
      true;

    workflow.cancellationRequestedAt =
      nowIso();

    return workflow;
  }

  async isCancellationRequested(
    tenantId,
    workflowId
  ) {
    const workflow =
      await this.getWorkflow(
        tenantId,
        workflowId
      );

    return (
      workflow
        ?.cancellationRequested ===
      true
    );
  }

  async listCheckpoints(
    tenantId,
    workflowId
  ) {
    return [
      ...(
        this.checkpoints.get(
          this.checkpointKey(
            tenantId,
            workflowId
          )
        ) ?? new Map()
      ).values()
    ].sort(
      (a, b) =>
        a.ordinal -
        b.ordinal
    );
  }

  async saveCheckpoint(
    tenantId,
    workflowId,
    ordinal,
    action,
    outcome
  ) {
    const key =
      this.checkpointKey(
        tenantId,
        workflowId
      );

    if (
      !this.checkpoints.has(
        key
      )
    ) {
      this.checkpoints.set(
        key,
        new Map()
      );
    }

    const checkpoints =
      this.checkpoints.get(key);

    const current =
      checkpoints.get(
        action.actionId
      );

    const record = {
      tenantId,
      workflowId,

      actionId:
        action.actionId,

      ordinal,

      actionEnvelope:
        structuredClone(
          action
        ),

      outcomeEnvelope:
        structuredClone(
          outcome
        ),

      status:
        outcome.status,

      attempts:
        outcome.attempts
          ?.length ?? 0,

      startedAt:
        current?.startedAt ??
        nowIso(),

      completedAt:
        nowIso()
    };

    checkpoints.set(
      action.actionId,
      record
    );

    return record;
  }

  async acquireLease({
    tenantId,
    workflowId,
    owner,
    ttlMs
  }) {
    const key =
      workflowKey(
        tenantId,
        workflowId
      );

    const existing =
      this.leases.get(key);

    if (
      existing &&
      Date.parse(
        existing.expiresAt
      ) >
      Date.now()
    ) {
      return null;
    }

    const lease = {
      tenantId,
      workflowId,

      leaseOwner:
        owner,

      leaseToken:
        randomUUID(),

      acquiredAt:
        nowIso(),

      heartbeatAt:
        nowIso(),

      expiresAt:
        new Date(
          Date.now() +
          ttlMs
        ).toISOString()
    };

    this.leases.set(
      key,
      lease
    );

    return lease;
  }

  async heartbeatLease(
    tenantId,
    workflowId,
    token,
    ttlMs
  ) {
    const key =
      workflowKey(
        tenantId,
        workflowId
      );

    const lease =
      this.leases.get(key);

    if (
      !lease ||
      lease.leaseToken !==
        token ||
      Date.parse(
        lease.expiresAt
      ) <=
        Date.now()
    ) {
      return null;
    }

    lease.heartbeatAt =
      nowIso();

    lease.expiresAt =
      new Date(
        Date.now() +
        ttlMs
      ).toISOString();

    return lease;
  }

  async releaseLease(
    tenantId,
    workflowId,
    token
  ) {
    const key =
      workflowKey(
        tenantId,
        workflowId
      );

    const lease =
      this.leases.get(key);

    if (
      !lease ||
      lease.leaseToken !==
        token
    ) {
      return false;
    }

    this.leases.delete(key);

    return true;
  }

  async listRecoverable(
    tenantId,
    staleBefore
  ) {
    const threshold =
      Date.parse(
        staleBefore
      );

    return [
      ...this.workflows.values()
    ].filter(
      (workflow) => {
        if (
          workflow.tenantId !==
          tenantId
        ) {
          return false;
        }

        if (
          workflow.executionState !==
          "RUNNING"
        ) {
          return false;
        }

        if (
          !workflow.lastHeartbeatAt ||
          Date.parse(
            workflow.lastHeartbeatAt
          ) >= threshold
        ) {
          return false;
        }

        const lease =
          this.leases.get(
            workflowKey(
              tenantId,
              workflow.workflowId
            )
          );

        return (
          !lease ||
          Date.parse(
            lease.expiresAt
          ) <=
            Date.now()
        );
      }
    );
  }

  async ready() {
    return true;
  }
}

export class PostgresBrainManagedStore {
  constructor(pool) {
    this.pool = pool;
  }

  async createWorkflow(
    request,
    coreResult
  ) {
    const insert =
      await this.pool.query(
        `
        INSERT INTO brain_managed_workflows (
          tenant_id,
          workflow_id,
          request_id,
          trace_id,
          correlation_id,
          idempotency_key,
          request_envelope,
          core_result_envelope,
          execution_state
        )
        VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,$8,'PENDING'
        )
        ON CONFLICT (
          tenant_id,
          workflow_id
        )
        DO NOTHING
        RETURNING *
        `,
        [
          request.tenantId,
          request.workflowId,
          request.requestId,
          request.traceId,
          request.correlationId,
          request.idempotencyKey ??
            null,
          request,
          coreResult
        ]
      );

    if (insert.rowCount) {
      return {
        created: true,
        workflow:
          normalizeWorkflowRow(
            insert.rows[0]
          )
      };
    }

    return {
      created: false,
      workflow:
        await this.getWorkflow(
          request.tenantId,
          request.workflowId
        )
    };
  }

  async getWorkflow(
    tenantId,
    workflowId
  ) {
    const result =
      await this.pool.query(
        `
        SELECT *
        FROM brain_managed_workflows
        WHERE
          tenant_id = $1
          AND workflow_id = $2
        LIMIT 1
        `,
        [
          tenantId,
          workflowId
        ]
      );

    return normalizeWorkflowRow(
      result.rows[0] ??
      null
    );
  }

  async setRunning(
    tenantId,
    workflowId
  ) {
    const result =
      await this.pool.query(
        `
        UPDATE brain_managed_workflows
        SET
          execution_state = 'RUNNING',
          started_at =
            COALESCE(
              started_at,
              now()
            ),
          last_heartbeat_at = now(),
          updated_at = now()
        WHERE
          tenant_id = $1
          AND workflow_id = $2
          AND execution_state <> 'COMPLETED'
        RETURNING *
        `,
        [
          tenantId,
          workflowId
        ]
      );

    return normalizeWorkflowRow(
      result.rows[0] ??
      null
    );
  }

  async heartbeatWorkflow(
    tenantId,
    workflowId
  ) {
    const result =
      await this.pool.query(
        `
        UPDATE brain_managed_workflows
        SET
          last_heartbeat_at = now(),
          updated_at = now()
        WHERE
          tenant_id = $1
          AND workflow_id = $2
          AND execution_state = 'RUNNING'
        RETURNING *
        `,
        [
          tenantId,
          workflowId
        ]
      );

    return normalizeWorkflowRow(
      result.rows[0] ??
      null
    );
  }

  async markRecoveryRequired(
    tenantId,
    workflowId
  ) {
    const result =
      await this.pool.query(
        `
        UPDATE brain_managed_workflows
        SET
          execution_state =
            'RECOVERY_REQUIRED',
          updated_at = now()
        WHERE
          tenant_id = $1
          AND workflow_id = $2
          AND execution_state <> 'COMPLETED'
        RETURNING *
        `,
        [
          tenantId,
          workflowId
        ]
      );

    return normalizeWorkflowRow(
      result.rows[0] ??
      null
    );
  }

  async completeWorkflow(
    tenantId,
    workflowId,
    status,
    resultEnvelope
  ) {
    const result =
      await this.pool.query(
        `
        UPDATE brain_managed_workflows
        SET
          execution_state = 'COMPLETED',
          terminal_status = $3,
          result_envelope = $4,
          completed_at = now(),
          last_heartbeat_at = now(),
          updated_at = now()
        WHERE
          tenant_id = $1
          AND workflow_id = $2
        RETURNING *
        `,
        [
          tenantId,
          workflowId,
          status,
          resultEnvelope
        ]
      );

    return normalizeWorkflowRow(
      result.rows[0] ??
      null
    );
  }

  async requestCancellation(
    tenantId,
    workflowId
  ) {
    const result =
      await this.pool.query(
        `
        UPDATE brain_managed_workflows
        SET
          cancellation_requested =
            CASE
              WHEN execution_state = 'COMPLETED'
              THEN cancellation_requested
              ELSE TRUE
            END,
          cancellation_requested_at =
            CASE
              WHEN execution_state = 'COMPLETED'
              THEN cancellation_requested_at
              ELSE COALESCE(
                cancellation_requested_at,
                now()
              )
            END,
          updated_at = now()
        WHERE
          tenant_id = $1
          AND workflow_id = $2
        RETURNING *
        `,
        [
          tenantId,
          workflowId
        ]
      );

    return normalizeWorkflowRow(
      result.rows[0] ??
      null
    );
  }

  async isCancellationRequested(
    tenantId,
    workflowId
  ) {
    const result =
      await this.pool.query(
        `
        SELECT cancellation_requested
        FROM brain_managed_workflows
        WHERE
          tenant_id = $1
          AND workflow_id = $2
        LIMIT 1
        `,
        [
          tenantId,
          workflowId
        ]
      );

    return (
      result.rows[0]
        ?.cancellation_requested ===
      true
    );
  }

  async listCheckpoints(
    tenantId,
    workflowId
  ) {
    const result =
      await this.pool.query(
        `
        SELECT *
        FROM brain_managed_action_checkpoints
        WHERE
          tenant_id = $1
          AND workflow_id = $2
        ORDER BY ordinal ASC
        `,
        [
          tenantId,
          workflowId
        ]
      );

    return result.rows.map(
      normalizeCheckpointRow
    );
  }

  async saveCheckpoint(
    tenantId,
    workflowId,
    ordinal,
    action,
    outcome
  ) {
    const result =
      await this.pool.query(
        `
        INSERT INTO brain_managed_action_checkpoints (
          tenant_id,
          workflow_id,
          action_id,
          ordinal,
          action_envelope,
          outcome_envelope,
          status,
          attempts,
          started_at,
          completed_at
        )
        VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,$8,
          now(),
          now()
        )
        ON CONFLICT (
          tenant_id,
          workflow_id,
          action_id
        )
        DO UPDATE
        SET
          ordinal =
            EXCLUDED.ordinal,
          action_envelope =
            EXCLUDED.action_envelope,
          outcome_envelope =
            EXCLUDED.outcome_envelope,
          status =
            EXCLUDED.status,
          attempts =
            EXCLUDED.attempts,
          completed_at = now(),
          updated_at = now()
        RETURNING *
        `,
        [
          tenantId,
          workflowId,
          action.actionId,
          ordinal,
          action,
          outcome,
          outcome.status,
          outcome.attempts
            ?.length ?? 0
        ]
      );

    return normalizeCheckpointRow(
      result.rows[0]
    );
  }

  async acquireLease({
    tenantId,
    workflowId,
    owner,
    ttlMs
  }) {
    const token =
      randomUUID();

    const result =
      await this.pool.query(
        `
        INSERT INTO brain_orchestration_leases (
          tenant_id,
          workflow_id,
          lease_owner,
          lease_token,
          acquired_at,
          heartbeat_at,
          expires_at
        )
        VALUES (
          $1,$2,$3,$4,
          now(),
          now(),
          now() +
            ($5 || ' milliseconds')::interval
        )
        ON CONFLICT (
          tenant_id,
          workflow_id
        )
        DO UPDATE
        SET
          lease_owner =
            EXCLUDED.lease_owner,
          lease_token =
            EXCLUDED.lease_token,
          acquired_at = now(),
          heartbeat_at = now(),
          expires_at =
            EXCLUDED.expires_at
        WHERE
          brain_orchestration_leases.expires_at
            <= now()
        RETURNING *
        `,
        [
          tenantId,
          workflowId,
          owner,
          token,
          ttlMs
        ]
      );

    const row =
      result.rows[0];

    if (!row) {
      return null;
    }

    return {
      tenantId:
        row.tenant_id,
      workflowId:
        row.workflow_id,
      leaseOwner:
        row.lease_owner,
      leaseToken:
        row.lease_token,
      acquiredAt:
        row.acquired_at,
      heartbeatAt:
        row.heartbeat_at,
      expiresAt:
        row.expires_at
    };
  }

  async heartbeatLease(
    tenantId,
    workflowId,
    token,
    ttlMs
  ) {
    const result =
      await this.pool.query(
        `
        UPDATE brain_orchestration_leases
        SET
          heartbeat_at = now(),
          expires_at =
            now() +
            ($4 || ' milliseconds')::interval
        WHERE
          tenant_id = $1
          AND workflow_id = $2
          AND lease_token = $3
          AND expires_at > now()
        RETURNING *
        `,
        [
          tenantId,
          workflowId,
          token,
          ttlMs
        ]
      );

    return (
      result.rows[0] ??
      null
    );
  }

  async releaseLease(
    tenantId,
    workflowId,
    token
  ) {
    const result =
      await this.pool.query(
        `
        DELETE FROM brain_orchestration_leases
        WHERE
          tenant_id = $1
          AND workflow_id = $2
          AND lease_token = $3
        `,
        [
          tenantId,
          workflowId,
          token
        ]
      );

    return (
      result.rowCount > 0
    );
  }

  async listRecoverable(
    tenantId,
    staleBefore
  ) {
    const result =
      await this.pool.query(
        `
        SELECT w.*
        FROM brain_managed_workflows w
        LEFT JOIN brain_orchestration_leases l
          ON l.tenant_id =
            w.tenant_id
          AND l.workflow_id =
            w.workflow_id
        WHERE
          w.tenant_id = $1
          AND w.execution_state = 'RUNNING'
          AND w.last_heartbeat_at < $2
          AND (
            l.workflow_id IS NULL
            OR l.expires_at <= now()
          )
        ORDER BY
          w.last_heartbeat_at ASC
        `,
        [
          tenantId,
          staleBefore
        ]
      );

    return result.rows.map(
      normalizeWorkflowRow
    );
  }

  async ready() {
    await this.pool.query(
      "SELECT 1"
    );

    return true;
  }
}

export class ManagedBrainOrchestrationRuntime {
  constructor({
    coreRuntime,
    executor,
    orchestrationStore,
    workflowStore,

    owner =
      `brain-${process.pid}-${randomUUID()}`,

    leaseTtlMs =
      DEFAULT_LEASE_TTL_MS,

    staleRunMs =
      DEFAULT_STALE_RUN_MS
  }) {
    if (!coreRuntime) {
      throw new Error(
        "coreRuntime is required"
      );
    }

    if (!executor) {
      throw new Error(
        "executor is required"
      );
    }

    if (!orchestrationStore) {
      throw new Error(
        "orchestrationStore is required"
      );
    }

    if (!workflowStore) {
      throw new Error(
        "workflowStore is required"
      );
    }

    if (
      !Number.isInteger(
        leaseTtlMs
      ) ||
      leaseTtlMs < 1000
    ) {
      throw new Error(
        "leaseTtlMs must be >= 1000"
      );
    }

    if (
      !Number.isInteger(
        staleRunMs
      ) ||
      staleRunMs <
        leaseTtlMs
    ) {
      throw new Error(
        "staleRunMs must be >= leaseTtlMs"
      );
    }

    this.coreRuntime =
      coreRuntime;

    this.executor =
      executor;

    this.orchestrationStore =
      orchestrationStore;

    this.workflowStore =
      workflowStore;

    this.owner =
      owner;

    this.leaseTtlMs =
      leaseTtlMs;

    this.staleRunMs =
      staleRunMs;
  }

  async ensureWorkflow(
    input,
    authenticatedTenant
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

    const created =
      await this.workflowStore
        .createWorkflow(
          request,
          core.result
        );

    const workflow =
      created.workflow;

    if (!workflow) {
      throw new ManagedBrainError(
        500,
        "INTERNAL_ERROR",
        "workflow persistence failed"
      );
    }

    if (
      workflow.requestId !==
      request.requestId
    ) {
      const sameIdempotency =
        Boolean(
          request.idempotencyKey
        ) &&
        workflow.idempotencyKey ===
          request.idempotencyKey;

      if (!sameIdempotency) {
        throw new ManagedBrainError(
          409,
          "WORKFLOW_ERROR",
          "workflowId is already bound to a different request"
        );
      }
    }

    return {
      created:
        created.created,

      workflow
    };
  }

  async startLeaseHeartbeat(
    workflow,
    lease,
    controller
  ) {
    let lost = false;

    let busy = false;

    const intervalMs =
      Math.max(
        500,
        Math.floor(
          this.leaseTtlMs / 3
        )
      );

    const tick =
      async () => {
        if (
          busy ||
          controller.signal
            .aborted
        ) {
          return;
        }

        busy = true;

        try {
          const heartbeat =
            await this.workflowStore
              .heartbeatLease(
                workflow.tenantId,
                workflow.workflowId,
                lease.leaseToken,
                this.leaseTtlMs
              );

          if (!heartbeat) {
            lost = true;

            controller.abort(
              new Error(
                "workflow lease ownership lost"
              )
            );

            return;
          }

          await this.workflowStore
            .heartbeatWorkflow(
              workflow.tenantId,
              workflow.workflowId
            );

          if (
            await this.workflowStore
              .isCancellationRequested(
                workflow.tenantId,
                workflow.workflowId
              )
          ) {
            controller.abort(
              new Error(
                "workflow cancellation requested"
              )
            );
          }
        } finally {
          busy = false;
        }
      };

    const timer =
      setInterval(
        () => {
          tick().catch(
            () => {
              lost = true;

              controller.abort(
                new Error(
                  "workflow heartbeat failed"
                )
              );
            }
          );
        },
        intervalMs
      );

    timer.unref?.();

    return {
      stop() {
        clearInterval(
          timer
        );
      },

      lost() {
        return lost;
      },

      tick
    };
  }

  async execute(
    input,
    authenticatedTenant,
    {
      signal
    } = {}
  ) {
    const ensured =
      await this.ensureWorkflow(
        input,
        authenticatedTenant
      );

    const workflow =
      ensured.workflow;

    if (
      workflow.executionState ===
        "COMPLETED" &&
      workflow.resultEnvelope
    ) {
      return {
        duplicate: true,
        resumed: false,
        result:
          workflow.resultEnvelope,

        lineage:
          (
            await this.workflowStore
              .listCheckpoints(
                workflow.tenantId,
                workflow.workflowId
              )
          ).map(
            (checkpoint) =>
              checkpoint.outcomeEnvelope
          )
      };
    }

    return this.runWorkflow(
      workflow,
      {
        signal,
        resumed:
          workflow.executionState ===
            "RECOVERY_REQUIRED"
      }
    );
  }

  async resume(
    tenantId,
    workflowId
  ) {
    const workflow =
      await this.workflowStore
        .getWorkflow(
          tenantId,
          workflowId
        );

    if (!workflow) {
      throw new ManagedBrainError(
        404,
        "WORKFLOW_ERROR",
        "workflow not found"
      );
    }

    if (
      workflow.executionState ===
      "COMPLETED"
    ) {
      return {
        duplicate: true,
        resumed: false,
        result:
          workflow.resultEnvelope,

        lineage:
          (
            await this.workflowStore
              .listCheckpoints(
                tenantId,
                workflowId
              )
          ).map(
            (checkpoint) =>
              checkpoint.outcomeEnvelope
          )
      };
    }

    if (
      workflow.executionState !==
        "RECOVERY_REQUIRED"
    ) {
      throw new ManagedBrainError(
        409,
        "WORKFLOW_ERROR",
        `workflow is ${workflow.executionState}, not RECOVERY_REQUIRED`
      );
    }

    return this.runWorkflow(
      workflow,
      {
        resumed: true
      }
    );
  }

  async runWorkflow(
    workflow,
    {
      signal,
      resumed = false
    } = {}
  ) {
    const lease =
      await this.workflowStore
        .acquireLease({
          tenantId:
            workflow.tenantId,

          workflowId:
            workflow.workflowId,

          owner:
            this.owner,

          ttlMs:
            this.leaseTtlMs
        });

    if (!lease) {
      throw new ManagedBrainError(
        409,
        "WORKFLOW_ERROR",
        "workflow is already being executed by another Brain worker",
        true
      );
    }

    const controller =
      new AbortController();

    const externalAbort =
      () =>
        controller.abort(
          signal?.reason ??
          new Error(
            "external cancellation"
          )
        );

    if (signal) {
      if (signal.aborted) {
        externalAbort();
      } else {
        signal.addEventListener(
          "abort",
          externalAbort,
          {
            once: true
          }
        );
      }
    }

    let heartbeat;

    try {
      const running =
        await this.workflowStore
          .setRunning(
            workflow.tenantId,
            workflow.workflowId
          );

      if (!running) {
        throw new ManagedBrainError(
          409,
          "WORKFLOW_ERROR",
          "workflow can no longer enter RUNNING state"
        );
      }

      heartbeat =
        await this.startLeaseHeartbeat(
          workflow,
          lease,
          controller
        );

      await heartbeat.tick();

      if (heartbeat.lost()) {
        throw new ManagedBrainError(
          409,
          "WORKFLOW_ERROR",
          "workflow lease ownership lost",
          true
        );
      }

      const request =
        workflow.requestEnvelope;

      const coreResult =
        workflow.coreResultEnvelope;

      const plannedActions =
        coreResult
          ?.result
          ?.decision
          ?.actions ?? [];

      const existingCheckpoints =
        await this.workflowStore
          .listCheckpoints(
            workflow.tenantId,
            workflow.workflowId
          );

      const checkpointByAction =
        new Map(
          existingCheckpoints.map(
            (checkpoint) => [
              checkpoint.actionId,
              checkpoint
            ]
          )
        );

      const lineage = [];

      for (
        let ordinal = 0;
        ordinal <
          plannedActions.length;
        ordinal += 1
      ) {
        const action =
          plannedActions[
            ordinal
          ];

        const checkpoint =
          checkpointByAction.get(
            action.actionId
          );

        if (
          checkpoint?.status ===
            "SUCCEEDED" &&
          checkpoint
            .outcomeEnvelope
        ) {
          lineage.push(
            checkpoint
              .outcomeEnvelope
          );

          continue;
        }

        if (
          heartbeat.lost()
        ) {
          throw new ManagedBrainError(
            409,
            "WORKFLOW_ERROR",
            "workflow lease ownership lost",
            true
          );
        }

        const cancellationRequested =
          await this.workflowStore
            .isCancellationRequested(
              workflow.tenantId,
              workflow.workflowId
            );

        if (
          cancellationRequested ||
          controller.signal.aborted
        ) {
          const cancelled = {
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
                "Workflow cancellation requested",

              retryable:
                false
            }
          };

          await this.workflowStore
            .saveCheckpoint(
              workflow.tenantId,
              workflow.workflowId,
              ordinal,
              action,
              cancelled
            );

          lineage.push(
            cancelled
          );

          continue;
        }

        const outcome =
          await this.executor
            .executeAction(
              request,
              action,
              {
                signal:
                  controller.signal
              }
            );

        await this.workflowStore
          .saveCheckpoint(
            workflow.tenantId,
            workflow.workflowId,
            ordinal,
            action,
            outcome
          );

        lineage.push(
          outcome
        );

        await heartbeat.tick();

        if (
          heartbeat.lost()
        ) {
          throw new ManagedBrainError(
            409,
            "WORKFLOW_ERROR",
            "workflow lease ownership lost after action execution",
            true
          );
        }
      }

      const status =
        calculateFinalStatus(
          lineage
        );

      const errors =
        lineage
          .map(
            canonicalActionError
          )
          .filter(Boolean);

      const result = {
        ...coreResult,

        status,

        timestamp:
          nowIso(),

        result: {
          ...coreResult.result,

          orchestration: {
            resumed,

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

      await this.orchestrationStore
        .save(
          request,
          result,
          lineage
        );

      await this.workflowStore
        .completeWorkflow(
          workflow.tenantId,
          workflow.workflowId,
          status,
          result
        );

      return {
        duplicate: false,
        resumed,
        result,
        lineage
      };
    } catch (error) {
      if (
        !(
          await this.workflowStore
            .isCancellationRequested(
              workflow.tenantId,
              workflow.workflowId
            )
        )
      ) {
        await this.workflowStore
          .markRecoveryRequired(
            workflow.tenantId,
            workflow.workflowId
          );
      }

      throw error;
    } finally {
      heartbeat?.stop();

      if (signal) {
        signal.removeEventListener(
          "abort",
          externalAbort
        );
      }

      await this.workflowStore
        .releaseLease(
          workflow.tenantId,
          workflow.workflowId,
          lease.leaseToken
        );
    }
  }

  async inspect(
    tenantId,
    workflowId
  ) {
    if (
      !tenantId ||
      !workflowId
    ) {
      throw new ManagedBrainError(
        400,
        "VALIDATION_ERROR",
        "tenant and workflow are required"
      );
    }

    const workflow =
      await this.workflowStore
        .getWorkflow(
          tenantId,
          workflowId
        );

    if (!workflow) {
      throw new ManagedBrainError(
        404,
        "WORKFLOW_ERROR",
        "workflow not found"
      );
    }

    const checkpoints =
      await this.workflowStore
        .listCheckpoints(
          tenantId,
          workflowId
        );

    return {
      workflow: {
        tenantId:
          workflow.tenantId,

        workflowId:
          workflow.workflowId,

        requestId:
          workflow.requestId,

        traceId:
          workflow.traceId,

        correlationId:
          workflow.correlationId,

        executionState:
          workflow.executionState,

        terminalStatus:
          workflow.terminalStatus,

        cancellationRequested:
          workflow.cancellationRequested,

        startedAt:
          workflow.startedAt,

        lastHeartbeatAt:
          workflow.lastHeartbeatAt,

        completedAt:
          workflow.completedAt
      },

      checkpoints:
        checkpoints.map(
          (checkpoint) => ({
            actionId:
              checkpoint.actionId,

            ordinal:
              checkpoint.ordinal,

            status:
              checkpoint.status,

            attempts:
              checkpoint.attempts,

            outcome:
              checkpoint.outcomeEnvelope
          })
        )
    };
  }

  async cancel(
    tenantId,
    workflowId
  ) {
    const workflow =
      await this.workflowStore
        .requestCancellation(
          tenantId,
          workflowId
        );

    if (!workflow) {
      throw new ManagedBrainError(
        404,
        "WORKFLOW_ERROR",
        "workflow not found"
      );
    }

    return {
      workflowId,
      cancellationRequested:
        workflow.cancellationRequested,
      executionState:
        workflow.executionState,
      terminalStatus:
        workflow.terminalStatus
    };
  }

  async scanRecovery(
    tenantId
  ) {
    if (!tenantId) {
      throw new ManagedBrainError(
        400,
        "VALIDATION_ERROR",
        "tenant is required"
      );
    }

    const staleBefore =
      new Date(
        Date.now() -
        this.staleRunMs
      ).toISOString();

    const stale =
      await this.workflowStore
        .listRecoverable(
          tenantId,
          staleBefore
        );

    const marked = [];

    for (const workflow of stale) {
      const updated =
        await this.workflowStore
          .markRecoveryRequired(
            tenantId,
            workflow.workflowId
          );

      if (updated) {
        marked.push(
          updated.workflowId
        );
      }
    }

    return {
      tenantId,
      recoverable:
        marked.length,
      workflowIds:
        marked
    };
  }

  async ready() {
    await this.workflowStore
      .ready();

    await this.orchestrationStore
      .ready();

    if (
      typeof this.coreRuntime
        .ready === "function"
    ) {
      await this.coreRuntime
        .ready();
    }

    return true;
  }
}

export async function createConfiguredManagedBrainRuntime({
  env = process.env,
  transport,
  fetchImpl,
  coreRuntime,
  executor,
  orchestrationStore,
  workflowStore
} = {}) {
  const production =
    env.NODE_ENV ===
      "production" ||
    env.PERSISTENCE_BACKEND ===
      "postgres";

  let resolvedCore =
    coreRuntime;

  let resolvedExecutor =
    executor;

  let resolvedOrchestrationStore =
    orchestrationStore;

  let resolvedWorkflowStore =
    workflowStore;

  let pool;

  if (production) {
    const connectionString =
      env.BRAIN_DATABASE_URL ||
      env.DATABASE_URL;

    if (!connectionString) {
      throw new Error(
        "BRAIN_DATABASE_URL is required for managed Brain orchestration"
      );
    }

    if (
      !resolvedCore ||
      !resolvedOrchestrationStore ||
      !resolvedWorkflowStore
    ) {
      const {
        Pool
      } =
        await import("pg");

      pool =
        new Pool({
          connectionString
        });
    }

    resolvedCore ??=
      new BrainCoreRuntime({
        store:
          new PostgresBrainCoreStore(
            pool
          )
      });

    resolvedOrchestrationStore ??=
      new PostgresBrainOrchestrationStore(
        pool
      );

    resolvedWorkflowStore ??=
      new PostgresBrainManagedStore(
        pool
      );
  } else {
    resolvedCore ??=
      new BrainCoreRuntime({
        store:
          new InMemoryBrainCoreStore()
      });

    resolvedOrchestrationStore ??=
      new InMemoryBrainOrchestrationStore();

    resolvedWorkflowStore ??=
      new InMemoryBrainManagedStore();
  }

  const resolvedTransport =
    transport ??
    new HttpBrainDownstreamTransport({
      env,

      fetchImpl:
        fetchImpl ??
        globalThis.fetch
    });

  resolvedExecutor ??=
    new BrainOrchestrationRuntime({
      coreRuntime:
        resolvedCore,

      store:
        resolvedOrchestrationStore,

      transport:
        resolvedTransport,

      maxAttempts:
        Number(
          env.BRAIN_ORCHESTRATION_MAX_ATTEMPTS ??
          3
        ),

      baseBackoffMs:
        Number(
          env.BRAIN_ORCHESTRATION_BACKOFF_MS ??
          100
        )
    });

  return new ManagedBrainOrchestrationRuntime({
    coreRuntime:
      resolvedCore,

    executor:
      resolvedExecutor,

    orchestrationStore:
      resolvedOrchestrationStore,

    workflowStore:
      resolvedWorkflowStore,

    leaseTtlMs:
      Number(
        env.BRAIN_LEASE_TTL_MS ??
        30000
      ),

    staleRunMs:
      Number(
        env.BRAIN_STALE_RUN_MS ??
        60000
      )
  });
}

function parseWorkflowPath(
  pathname
) {
  const match =
    pathname.match(
      /^\/v1\/ai\/workflows\/([^/]+)(?:\/(cancel|resume))?$/
    );

  if (!match) {
    return null;
  }

  return {
    workflowId:
      decodeURIComponent(
        match[1]
      ),

    action:
      match[2] ??
      null
  };
}

export function createManagedBrainEndpoint({
  env = process.env,
  runtime
} = {}) {
  let resolvedRuntime =
    runtime;

  const getRuntime =
    async () => {
      resolvedRuntime ??=
        await createConfiguredManagedBrainRuntime({
          env
        });

      return resolvedRuntime;
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
              "managed-orchestration",

            recovery:
              "enabled"
          }
        );
      } catch {
        fail(
          res,
          503,
          "DEPENDENCY_ERROR",
          "Managed Brain orchestration is unavailable"
        );
      }

      return true;
    }

    if (!tenantId) {
      if (
        url.pathname.startsWith(
          "/v1/ai/"
        )
      ) {
        fail(
          res,
          400,
          "VALIDATION_ERROR",
          "tenant header is required"
        );

        return true;
      }

      return false;
    }

    if (
      req.method === "POST" &&
      url.pathname ===
        "/v1/ai/orchestrate"
    ) {
      try {
        let input;

        try {
          input =
            JSON.parse(
              bodyText || "{}"
            );
        } catch {
          throw new ManagedBrainError(
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

            resumed:
              execution.resumed,

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
            : "Managed Brain orchestration failed"
        );
      }

      return true;
    }

    if (
      req.method === "POST" &&
      url.pathname ===
        "/v1/ai/recovery/scan"
    ) {
      try {
        const result =
          await (
            await getRuntime()
          ).scanRecovery(
            tenantId
          );

        send(
          res,
          200,
          result
        );
      } catch (error) {
        fail(
          res,
          error.status ?? 500,
          error.code ??
            "INTERNAL_ERROR",
          error.message
        );
      }

      return true;
    }

    const workflowPath =
      parseWorkflowPath(
        url.pathname
      );

    if (!workflowPath) {
      return false;
    }

    try {
      const managed =
        await getRuntime();

      if (
        req.method === "GET" &&
        !workflowPath.action
      ) {
        const result =
          await managed.inspect(
            tenantId,
            workflowPath.workflowId
          );

        send(
          res,
          200,
          result
        );

        return true;
      }

      if (
        req.method === "POST" &&
        workflowPath.action ===
          "cancel"
      ) {
        const result =
          await managed.cancel(
            tenantId,
            workflowPath.workflowId
          );

        send(
          res,
          202,
          result
        );

        return true;
      }

      if (
        req.method === "POST" &&
        workflowPath.action ===
          "resume"
      ) {
        const result =
          await managed.resume(
            tenantId,
            workflowPath.workflowId
          );

        send(
          res,
          result.duplicate
            ? 200
            : 202,
          {
            duplicate:
              result.duplicate,

            resumed:
              result.resumed,

            ...result.result
          }
        );

        return true;
      }

      return false;
    } catch (error) {
      fail(
        res,
        error.status ?? 500,
        error.code ??
          "INTERNAL_ERROR",
        error.message
      );

      return true;
    }
  };
}