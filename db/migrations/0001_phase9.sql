BEGIN;
CREATE SCHEMA IF NOT EXISTS brain;
CREATE TABLE IF NOT EXISTS brain.orchestration_runs (
  tenant_id text NOT NULL, run_id uuid NOT NULL, user_id text NOT NULL,
  status text NOT NULL, request jsonb NOT NULL, result jsonb,
  trace_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, run_id)
);
CREATE INDEX IF NOT EXISTS brain_runs_user_idx ON brain.orchestration_runs (tenant_id, user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS brain.session_bindings (
  tenant_id text NOT NULL, session_hash text NOT NULL, user_id text NOT NULL,
  expires_at timestamptz NOT NULL, PRIMARY KEY (tenant_id, session_hash)
);
COMMIT;
