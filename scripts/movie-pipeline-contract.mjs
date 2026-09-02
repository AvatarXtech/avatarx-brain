import { randomUUID } from 'node:crypto';

export const MOVIE_EVENT_VERSION = '1.0';
export const MOVIE_PIPELINE_SERVICE = 'avatarx-brain';
export const ACCEPTED_MOVIE_EVENTS = Object.freeze(["movie.production.initialized","movie.scene.direction.requested","movie.continuity.evaluated","movie.approval.required"]);
export const EMITTED_MOVIE_EVENTS = Object.freeze(["movie.pipeline.commanded","movie.pipeline.paused","movie.pipeline.resumed","movie.pipeline.completed"]);

const requiredStrings = ['id', 'type', 'source', 'tenantId', 'projectId', 'traceId', 'occurredAt'];

export function validateMovieEvent(event, { acceptedTypes = ACCEPTED_MOVIE_EVENTS } = {}) {
  const issues = [];
  if (!event || typeof event !== 'object' || Array.isArray(event)) return { ok: false, issues: ['event must be an object'] };
  if (event.specversion !== MOVIE_EVENT_VERSION) issues.push('specversion must be 1.0');
  for (const field of requiredStrings) if (typeof event[field] !== 'string' || !event[field].trim()) issues.push(`${field} is required`);
  if (event.type && !/^movie\.[a-z0-9]+(?:\.[a-z0-9]+)+$/.test(event.type)) issues.push('type must use the movie.<domain>.<action> convention');
  if (event.occurredAt && Number.isNaN(Date.parse(event.occurredAt))) issues.push('occurredAt must be an ISO date-time');
  if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) issues.push('data must be an object');
  if (acceptedTypes && event.type && !acceptedTypes.includes(event.type)) issues.push(`unsupported event type for ${MOVIE_PIPELINE_SERVICE}`);
  return { ok: issues.length === 0, issues };
}

export function assertMovieEvent(event, options) {
  const result = validateMovieEvent(event, options);
  if (!result.ok) throw Object.assign(new Error('Invalid AI Movie Pipeline event'), { code: 'INVALID_MOVIE_EVENT', issues: result.issues });
  return event;
}

export function createMovieEvent(type, context, data = {}) {
  if (!EMITTED_MOVIE_EVENTS.includes(type)) throw Object.assign(new Error(`Unsupported emitted event type: ${type}`), { code: 'UNSUPPORTED_MOVIE_EVENT' });
  const event = {
    specversion: MOVIE_EVENT_VERSION,
    id: randomUUID(),
    type,
    source: MOVIE_PIPELINE_SERVICE,
    tenantId: context.tenantId,
    projectId: context.projectId,
    traceId: context.traceId,
    occurredAt: new Date().toISOString(),
    data
  };
  for (const field of ['sceneId','shotId','attemptId','correlationId','causationId','idempotencyKey','revision']) if (context[field] !== undefined) event[field] = context[field];
  return assertMovieEvent(event, { acceptedTypes: EMITTED_MOVIE_EVENTS });
}

export function movieEventDeduplicationKey(event) {
  assertMovieEvent(event);
  return `${event.tenantId}:${event.idempotencyKey || event.id}`;
}
