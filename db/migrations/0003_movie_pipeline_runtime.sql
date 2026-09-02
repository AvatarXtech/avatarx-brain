-- AvatarX AI Movie Pipeline runtime v1.1
-- Tables are service-local; tenant_id is included in every key and lookup.
CREATE TABLE IF NOT EXISTS movie_event_inbox (
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  event_id text NOT NULL,
  run_id text NOT NULL,
  event_type text NOT NULL,
  service text NOT NULL,
  envelope jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('processing','processed','failed','dead_letter')),
  attempts integer NOT NULL DEFAULT 0,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (tenant_id, event_id)
);

CREATE TABLE IF NOT EXISTS movie_event_outbox (
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  event_id text NOT NULL,
  run_id text NOT NULL,
  event_type text NOT NULL,
  envelope jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','publishing','published','dead_letter')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  published_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_id)
);

CREATE TABLE IF NOT EXISTS movie_pipeline_runs (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  run_id text NOT NULL,
  last_event_type text NOT NULL,
  trace_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, run_id)
);

CREATE INDEX IF NOT EXISTS movie_event_inbox_run_idx ON movie_event_inbox (tenant_id, run_id, received_at);
CREATE INDEX IF NOT EXISTS movie_event_outbox_publish_idx ON movie_event_outbox (status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS movie_pipeline_runs_project_idx ON movie_pipeline_runs (tenant_id, project_id, updated_at);
