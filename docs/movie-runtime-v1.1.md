# Executable AI Movie Pipeline runtime v1.1

This service participates in the first production vertical slice without changing `avatarx-ai-director` or `avatarx-ai-continuity`.

## Runtime endpoints

- `POST /v1/movie-events` accepts one signed v1.1 event and returns `202`; duplicate delivery returns the original result with `200`.
- `GET /ready/movie-runtime` verifies runtime persistence readiness.
- `GET /health` remains the process liveness endpoint.

Requests use the existing AvatarX HMAC headers and must include `x-tenant-id`. The event `tenantId` must match that header. Signatures cover method, path, timestamp, and the SHA-256 body digest.

## Persistence

Apply `db/migrations/0003_movie_pipeline_runtime.sql` before enabling PostgreSQL mode. Inbox insertion, run projection, and outbox insertion occur in one transaction. The `(tenant_id, event_id)` unique keys provide durable idempotency. Outbox workers claim rows with `SKIP LOCKED`, retry with exponential backoff, and dead-letter after the configured attempt limit.

Set `PERSISTENCE_BACKEND=postgres` and `DATABASE_URL` in deployed services. Development and unit tests use the in-memory adapter.

## First vertical slice

1. Director emits one scene direction.
2. Brain requests a bounded workflow.
3. Agents requests Knowledge, Memory, and Intelligence work.
4. Intelligence selects a model and requests inference.
5. Neuron returns a mocked inference result.
6. Continuity returns pass/fail.
7. Brain completes the pipeline, requests one regeneration, or requires approval after the bound is reached.
8. Analytics consumes the same events asynchronously and emits no blocking dependency.

All generated events preserve project, run, trace, and correlation identity and set the input event as `causationId`.
