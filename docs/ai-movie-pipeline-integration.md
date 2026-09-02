# AI Movie Pipeline integration

Status: proposed contract v1 on `feature/ai-movie-pipeline-contract-v1`.

## Service boundary

**avatarx-brain** is the **AI Movie Pipeline control plane** service for the AvatarX AI Movie Pipeline.

It owns: End-to-end coordination and operator visibility; delegates domain work to the other services.

It does not own AI Director production/scene/shot UX or AI Continuity movie-bible and continuity rules. Those remain in `avatarx-ai-director` and `avatarx-ai-continuity`.

## Contract

All cross-repository domain events use `contracts/avatarx.movie.event.v1.schema.json`. The envelope is tenant- and project-scoped and carries `traceId`, optional correlation/causation IDs, an idempotency key, revision and domain data. Producers must use UTC timestamps, stable event IDs and at-least-once delivery. Consumers must deduplicate with `idempotencyKey` (or `id` when absent) and reject cross-tenant access.

### Consumes

- `movie.production.initialized`
- `movie.scene.direction.requested`
- `movie.continuity.evaluated`
- `movie.approval.required`

### Produces

- `movie.pipeline.commanded`
- `movie.pipeline.paused`
- `movie.pipeline.resumed`
- `movie.pipeline.completed`

## Integration sequence

1. AI Director emits a project/scene/shot intent with IDs and a trace ID.
2. AvatarX Brain commands a bounded workflow through AvatarX Agents.
3. Knowledge and Memory resolve canonical context and prior approved decisions.
4. Intelligence selects policy, model and regeneration strategy.
5. Neuron executes provider-neutral inference and returns normalized assets/usage.
6. AI Continuity evaluates generated assets and returns pass, warning or failure.
7. Brain completes, pauses for approval, or requests another bounded attempt.
8. Analytics receives lifecycle events from every stage without becoming a transactional dependency.

## Non-negotiable controls

- Never place screenplay text, prompts, signed media URLs or personal data in event metadata or logs.
- Propagate `tenantId`, `projectId`, `traceId`, `correlationId` and `causationId` unchanged.
- Pin approved movie-bible and knowledge revisions for reproducible generations.
- Require explicit approval for final asset promotion and destructive/regenerative actions beyond policy limits.
- Use outbox/inbox delivery when PostgreSQL-backed runtime integration is added.
- Fail closed on invalid schema, missing tenant identity or unsupported event type.

## Initial acceptance criteria

- Contract schema validates representative production, scene, shot, inference and continuity events.
- Duplicate delivery does not repeat a side effect.
- One trace can reconstruct every generation attempt and continuity decision.
- A continuity failure can trigger a bounded regeneration without modifying either pipeline repository.
- Analytics unavailability never blocks production execution.
