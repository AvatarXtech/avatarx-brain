BEGIN;

CREATE TABLE IF NOT EXISTS brain_core_executions (
    id BIGSERIAL PRIMARY KEY,

    tenant_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    session_id TEXT NOT NULL,

    trace_id TEXT NOT NULL,
    correlation_id TEXT NOT NULL,

    operation TEXT NOT NULL,

    idempotency_key TEXT,

    request_envelope JSONB NOT NULL,
    result_envelope JSONB NOT NULL,

    status TEXT NOT NULL
        CHECK (
            status IN (
                'SUCCEEDED',
                'FAILED',
                'PARTIAL',
                'CANCELLED',
                'TIMED_OUT'
            )
        ),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tenant_id, request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS
    brain_core_execution_idempotency_idx
ON brain_core_executions (
    tenant_id,
    workflow_id,
    idempotency_key
)
WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS
    brain_core_execution_workflow_idx
ON brain_core_executions (
    tenant_id,
    workflow_id,
    created_at DESC
);

CREATE INDEX IF NOT EXISTS
    brain_core_execution_trace_idx
ON brain_core_executions (
    tenant_id,
    trace_id,
    created_at DESC
);

COMMIT;