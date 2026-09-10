BEGIN;

CREATE TABLE IF NOT EXISTS brain_managed_workflows (
    tenant_id TEXT NOT NULL,
    workflow_id TEXT NOT NULL,

    request_id TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    idempotency_key TEXT,

    request_envelope JSONB NOT NULL,
    core_result_envelope JSONB NOT NULL,

    execution_state TEXT NOT NULL
        CHECK (
            execution_state IN (
                'PENDING',
                'RUNNING',
                'RECOVERY_REQUIRED',
                'COMPLETED'
            )
        ),

    terminal_status TEXT
        CHECK (
            terminal_status IS NULL
            OR terminal_status IN (
                'SUCCEEDED',
                'FAILED',
                'PARTIAL',
                'CANCELLED',
                'TIMED_OUT'
            )
        ),

    cancellation_requested BOOLEAN NOT NULL DEFAULT FALSE,
    cancellation_requested_at TIMESTAMPTZ,

    result_envelope JSONB,

    started_at TIMESTAMPTZ,
    last_heartbeat_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (
        tenant_id,
        workflow_id
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS
    brain_managed_workflow_request_idx
ON brain_managed_workflows (
    tenant_id,
    request_id
);

CREATE UNIQUE INDEX IF NOT EXISTS
    brain_managed_workflow_idempotency_idx
ON brain_managed_workflows (
    tenant_id,
    workflow_id,
    idempotency_key
)
WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS
    brain_managed_workflow_recovery_idx
ON brain_managed_workflows (
    execution_state,
    last_heartbeat_at
)
WHERE execution_state IN (
    'RUNNING',
    'RECOVERY_REQUIRED'
);

CREATE TABLE IF NOT EXISTS
    brain_managed_action_checkpoints (
        tenant_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        action_id TEXT NOT NULL,

        ordinal INTEGER NOT NULL
            CHECK (ordinal >= 0),

        action_envelope JSONB NOT NULL,
        outcome_envelope JSONB,

        status TEXT NOT NULL
            CHECK (
                status IN (
                    'PENDING',
                    'RUNNING',
                    'SUCCEEDED',
                    'FAILED',
                    'CANCELLED',
                    'TIMED_OUT'
                )
            ),

        attempts INTEGER NOT NULL DEFAULT 0
            CHECK (attempts >= 0),

        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,

        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

        PRIMARY KEY (
            tenant_id,
            workflow_id,
            action_id
        ),

        FOREIGN KEY (
            tenant_id,
            workflow_id
        )
        REFERENCES brain_managed_workflows (
            tenant_id,
            workflow_id
        )
        ON DELETE CASCADE
    );

CREATE INDEX IF NOT EXISTS
    brain_managed_action_status_idx
ON brain_managed_action_checkpoints (
    tenant_id,
    workflow_id,
    status,
    ordinal
);

COMMIT;