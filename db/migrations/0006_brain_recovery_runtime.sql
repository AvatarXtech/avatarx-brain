BEGIN;

ALTER TABLE brain_orchestration_runs
    ADD COLUMN IF NOT EXISTS execution_state TEXT
        NOT NULL DEFAULT 'COMPLETED'
        CHECK (
            execution_state IN (
                'PENDING',
                'RUNNING',
                'COMPLETED',
                'RECOVERY_REQUIRED'
            )
        );

ALTER TABLE brain_orchestration_runs
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

ALTER TABLE brain_orchestration_runs
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE brain_orchestration_runs
    ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

ALTER TABLE brain_orchestration_runs
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS brain_orchestration_leases (
    tenant_id TEXT NOT NULL,
    workflow_id TEXT NOT NULL,

    lease_owner TEXT NOT NULL,
    lease_token TEXT NOT NULL,

    acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,

    PRIMARY KEY (
        tenant_id,
        workflow_id
    )
);

CREATE INDEX IF NOT EXISTS
    brain_orchestration_lease_expiry_idx
ON brain_orchestration_leases (
    expires_at
);

CREATE INDEX IF NOT EXISTS
    brain_orchestration_recovery_idx
ON brain_orchestration_runs (
    execution_state,
    last_heartbeat_at
)
WHERE execution_state IN (
    'RUNNING',
    'RECOVERY_REQUIRED'
);

COMMIT;