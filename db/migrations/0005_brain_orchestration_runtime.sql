BEGIN;

CREATE TABLE IF NOT EXISTS brain_orchestration_runs (
    id BIGSERIAL PRIMARY KEY,

    tenant_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    correlation_id TEXT NOT NULL,

    idempotency_key TEXT,

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

    request_envelope JSONB NOT NULL,
    result_envelope JSONB NOT NULL,
    action_lineage JSONB NOT NULL DEFAULT '[]'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (
        tenant_id,
        request_id
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS
    brain_orchestration_idempotency_idx
ON brain_orchestration_runs (
    tenant_id,
    workflow_id,
    idempotency_key
)
WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS
    brain_orchestration_workflow_idx
ON brain_orchestration_runs (
    tenant_id,
    workflow_id,
    created_at DESC
);

CREATE INDEX IF NOT EXISTS
    brain_orchestration_trace_idx
ON brain_orchestration_runs (
    tenant_id,
    trace_id,
    created_at DESC
);

COMMIT;