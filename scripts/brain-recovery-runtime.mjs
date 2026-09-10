import {
  randomUUID
} from "node:crypto";

export const DEFAULT_LEASE_TTL_MS = 30000;
export const DEFAULT_STALE_RUN_MS = 60000;

export class BrainRecoveryError extends Error {
  constructor(
    status,
    code,
    message,
    retryable = false
  ) {
    super(message);

    this.name = "BrainRecoveryError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function futureIso(ms) {
  return new Date(
    Date.now() + ms
  ).toISOString();
}

export class InMemoryBrainRecoveryStore {
  constructor() {
    this.runs = new Map();
    this.leases = new Map();
  }

  runKey(
    tenantId,
    workflowId
  ) {
    return `${tenantId}:${workflowId}`;
  }

  async beginRun({
    tenantId,
    workflowId,
    requestId,
    traceId
  }) {
    const key =
      this.runKey(
        tenantId,
        workflowId
      );

    const record = {
      tenantId,
      workflowId,
      requestId,
      traceId,
      executionState:
        "RUNNING",
      startedAt:
        nowIso(),
      lastHeartbeatAt:
        nowIso(),
      completedAt:
        null,
      cancelledAt:
        null
    };

    this.runs.set(
      key,
      record
    );

    return record;
  }

  async heartbeatRun(
    tenantId,
    workflowId
  ) {
    const record =
      this.runs.get(
        this.runKey(
          tenantId,
          workflowId
        )
      );

    if (!record) {
      return null;
    }

    record.lastHeartbeatAt =
      nowIso();

    return record;
  }

  async completeRun(
    tenantId,
    workflowId
  ) {
    const record =
      this.runs.get(
        this.runKey(
          tenantId,
          workflowId
        )
      );

    if (!record) {
      return null;
    }

    record.executionState =
      "COMPLETED";

    record.completedAt =
      nowIso();

    record.lastHeartbeatAt =
      nowIso();

    return record;
  }

  async cancelRun(
    tenantId,
    workflowId
  ) {
    const record =
      this.runs.get(
        this.runKey(
          tenantId,
          workflowId
        )
      );

    if (!record) {
      return null;
    }

    record.executionState =
      "COMPLETED";

    record.cancelledAt =
      nowIso();

    record.completedAt =
      nowIso();

    return record;
  }

  async getRun(
    tenantId,
    workflowId
  ) {
    return (
      this.runs.get(
        this.runKey(
          tenantId,
          workflowId
        )
      ) ?? null
    );
  }

  async listRecoverable(
    staleBefore
  ) {
    const threshold =
      Date.parse(
        staleBefore
      );

    return [
      ...this.runs.values()
    ].filter(
      (run) =>
        run.executionState ===
          "RUNNING" &&
        Date.parse(
          run.lastHeartbeatAt
        ) < threshold
    );
  }

  async markRecoveryRequired(
    tenantId,
    workflowId
  ) {
    const record =
      await this.getRun(
        tenantId,
        workflowId
      );

    if (!record) {
      return null;
    }

    record.executionState =
      "RECOVERY_REQUIRED";

    return record;
  }

  async acquireLease({
    tenantId,
    workflowId,
    owner,
    ttlMs
  }) {
    const key =
      this.runKey(
        tenantId,
        workflowId
      );

    const existing =
      this.leases.get(key);

    if (
      existing &&
      Date.parse(
        existing.expiresAt
      ) > Date.now()
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
        futureIso(ttlMs)
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
    leaseToken,
    ttlMs
  ) {
    const key =
      this.runKey(
        tenantId,
        workflowId
      );

    const lease =
      this.leases.get(key);

    if (
      !lease ||
      lease.leaseToken !==
        leaseToken
    ) {
      return null;
    }

    lease.heartbeatAt =
      nowIso();

    lease.expiresAt =
      futureIso(ttlMs);

    return lease;
  }

  async releaseLease(
    tenantId,
    workflowId,
    leaseToken
  ) {
    const key =
      this.runKey(
        tenantId,
        workflowId
      );

    const lease =
      this.leases.get(key);

    if (
      !lease ||
      lease.leaseToken !==
        leaseToken
    ) {
      return false;
    }

    this.leases.delete(key);

    return true;
  }

  async ready() {
    return true;
  }
}

export class PostgresBrainRecoveryStore {
  constructor(pool) {
    this.pool = pool;
  }

  async beginRun({
    tenantId,
    workflowId,
    requestId,
    traceId
  }) {
    const result =
      await this.pool.query(
        `
        UPDATE brain_orchestration_runs
        SET
          execution_state = 'RUNNING',
          started_at = COALESCE(started_at, now()),
          last_heartbeat_at = now(),
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

    if (result.rowCount) {
      return result.rows[0];
    }

    return {
      tenantId,
      workflowId,
      requestId,
      traceId,
      executionState:
        "RUNNING"
    };
  }

  async heartbeatRun(
    tenantId,
    workflowId
  ) {
    const result =
      await this.pool.query(
        `
        UPDATE brain_orchestration_runs
        SET
          last_heartbeat_at = now(),
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

    return (
      result.rows[0] ??
      null
    );
  }

  async completeRun(
    tenantId,
    workflowId
  ) {
    const result =
      await this.pool.query(
        `
        UPDATE brain_orchestration_runs
        SET
          execution_state = 'COMPLETED',
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
          workflowId
        ]
      );

    return (
      result.rows[0] ??
      null
    );
  }

  async cancelRun(
    tenantId,
    workflowId
  ) {
    const result =
      await this.pool.query(
        `
        UPDATE brain_orchestration_runs
        SET
          execution_state = 'COMPLETED',
          cancelled_at = now(),
          completed_at = now(),
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

    return (
      result.rows[0] ??
      null
    );
  }

  async getRun(
    tenantId,
    workflowId
  ) {
    const result =
      await this.pool.query(
        `
        SELECT *
        FROM brain_orchestration_runs
        WHERE
          tenant_id = $1
          AND workflow_id = $2
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [
          tenantId,
          workflowId
        ]
      );

    return (
      result.rows[0] ??
      null
    );
  }

  async listRecoverable(
    staleBefore
  ) {
    const result =
      await this.pool.query(
        `
        SELECT *
        FROM brain_orchestration_runs
        WHERE
          execution_state = 'RUNNING'
          AND last_heartbeat_at < $1
        ORDER BY last_heartbeat_at ASC
        `,
        [
          staleBefore
        ]
      );

    return result.rows;
  }

  async markRecoveryRequired(
    tenantId,
    workflowId
  ) {
    const result =
      await this.pool.query(
        `
        UPDATE brain_orchestration_runs
        SET
          execution_state = 'RECOVERY_REQUIRED',
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

    return (
      result.rows[0] ??
      null
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
          now() + ($5 || ' milliseconds')::interval
        )
        ON CONFLICT (
          tenant_id,
          workflow_id
        )
        DO UPDATE
        SET
          lease_owner = EXCLUDED.lease_owner,
          lease_token = EXCLUDED.lease_token,
          acquired_at = now(),
          heartbeat_at = now(),
          expires_at = EXCLUDED.expires_at
        WHERE
          brain_orchestration_leases.expires_at <= now()
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

    return (
      result.rows[0] ??
      null
    );
  }

  async heartbeatLease(
    tenantId,
    workflowId,
    leaseToken,
    ttlMs
  ) {
    const result =
      await this.pool.query(
        `
        UPDATE brain_orchestration_leases
        SET
          heartbeat_at = now(),
          expires_at =
            now() + ($4 || ' milliseconds')::interval
        WHERE
          tenant_id = $1
          AND workflow_id = $2
          AND lease_token = $3
        RETURNING *
        `,
        [
          tenantId,
          workflowId,
          leaseToken,
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
    leaseToken
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
          leaseToken
        ]
      );

    return (
      result.rowCount > 0
    );
  }

  async ready() {
    await this.pool.query(
      "SELECT 1"
    );

    return true;
  }
}

export class BrainRecoveryRuntime {
  constructor({
    store =
      new InMemoryBrainRecoveryStore(),

    leaseTtlMs =
      DEFAULT_LEASE_TTL_MS,

    staleRunMs =
      DEFAULT_STALE_RUN_MS,

    owner =
      `brain-${process.pid}`
  } = {}) {
    if (
      !Number.isInteger(
        leaseTtlMs
      ) ||
      leaseTtlMs < 1000
    ) {
      throw new Error(
        "leaseTtlMs must be at least 1000"
      );
    }

    if (
      !Number.isInteger(
        staleRunMs
      ) ||
      staleRunMs < leaseTtlMs
    ) {
      throw new Error(
        "staleRunMs must be >= leaseTtlMs"
      );
    }

    this.store =
      store;

    this.leaseTtlMs =
      leaseTtlMs;

    this.staleRunMs =
      staleRunMs;

    this.owner =
      owner;
  }

  async acquire(
    tenantId,
    workflowId
  ) {
    const lease =
      await this.store.acquireLease({
        tenantId,
        workflowId,
        owner:
          this.owner,
        ttlMs:
          this.leaseTtlMs
      });

    if (!lease) {
      throw new BrainRecoveryError(
        409,
        "WORKFLOW_ERROR",
        "workflow is already owned by another Brain worker",
        true
      );
    }

    return lease;
  }

  async heartbeat(
    tenantId,
    workflowId,
    leaseToken
  ) {
    const lease =
      await this.store.heartbeatLease(
        tenantId,
        workflowId,
        leaseToken,
        this.leaseTtlMs
      );

    if (!lease) {
      throw new BrainRecoveryError(
        409,
        "WORKFLOW_ERROR",
        "workflow lease ownership was lost",
        true
      );
    }

    await this.store.heartbeatRun(
      tenantId,
      workflowId
    );

    return lease;
  }

  async release(
    tenantId,
    workflowId,
    leaseToken
  ) {
    return this.store.releaseLease(
      tenantId,
      workflowId,
      leaseToken
    );
  }

  async begin(request) {
    return this.store.beginRun({
      tenantId:
        request.tenantId,
      workflowId:
        request.workflowId,
      requestId:
        request.requestId,
      traceId:
        request.traceId
    });
  }

  async complete(
    tenantId,
    workflowId
  ) {
    return this.store.completeRun(
      tenantId,
      workflowId
    );
  }

  async cancel(
    tenantId,
    workflowId
  ) {
    return this.store.cancelRun(
      tenantId,
      workflowId
    );
  }

  async inspect(
    tenantId,
    workflowId
  ) {
    if (
      !tenantId ||
      !workflowId
    ) {
      throw new BrainRecoveryError(
        400,
        "VALIDATION_ERROR",
        "tenantId and workflowId are required"
      );
    }

    return this.store.getRun(
      tenantId,
      workflowId
    );
  }

  async scanRecovery() {
    const staleBefore =
      new Date(
        Date.now() -
        this.staleRunMs
      ).toISOString();

    const stale =
      await this.store.listRecoverable(
        staleBefore
      );

    const marked = [];

    for (const run of stale) {
      const tenantId =
        run.tenantId ??
        run.tenant_id;

      const workflowId =
        run.workflowId ??
        run.workflow_id;

      const updated =
        await this.store
          .markRecoveryRequired(
            tenantId,
            workflowId
          );

      if (updated) {
        marked.push(
          updated
        );
      }
    }

    return marked;
  }

  async ready() {
    return this.store.ready();
  }
}