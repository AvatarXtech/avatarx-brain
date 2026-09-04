import { randomUUID } from 'node:crypto';

export const EVENT_VERSION = '1.1';
export const SERVICE_PROFILES = Object.freeze({
  'avatarx-brain': {
    accepts: ['movie.production.initialized', 'movie.scene.direction.requested', 'movie.continuity.evaluated'],
    transitions: {
      'movie.production.initialized': ['movie.pipeline.commanded'],
      'movie.scene.direction.requested': ['movie.workflow.requested'],
      'movie.continuity.evaluated': ({ event, maxRegenerations }) => {
        if (event.data?.passed === true) return ['movie.pipeline.completed'];
        const attempt = Number(event.data?.regenerationAttempt ?? 0);
        return attempt < maxRegenerations ? ['movie.shot.regeneration.requested'] : ['movie.approval.required'];
      }
    }
  },
  'avatarx-agents': {
    accepts: ['movie.workflow.requested', 'movie.shot.regeneration.requested', 'movie.knowledge.context.resolved', 'movie.memory.recalled', 'movie.inference.completed'],
    transitions: {
      'movie.workflow.requested': ['movie.workflow.started', 'movie.knowledge.query.requested', 'movie.memory.recall.requested', 'movie.intelligence.decision.requested'],
      'movie.shot.regeneration.requested': ['movie.workflow.started', 'movie.intelligence.decision.requested'],
      'movie.knowledge.context.resolved': [],
      'movie.memory.recalled': [],
      'movie.inference.completed': ['movie.workflow.completed']
    }
  },
  'avatarx-knowledge': { accepts: ['movie.knowledge.query.requested'], transitions: { 'movie.knowledge.query.requested': ['movie.knowledge.context.resolved'] } },
  'avatarx-memory': { accepts: ['movie.memory.recall.requested', 'movie.continuity.evaluated'], transitions: { 'movie.memory.recall.requested': ['movie.memory.recalled'], 'movie.continuity.evaluated': ['movie.memory.recorded'] } },
  'avatarx-intelligence': { accepts: ['movie.intelligence.decision.requested'], transitions: { 'movie.intelligence.decision.requested': ['movie.model.selected', 'movie.inference.requested'] } },
  'avatarx-neuron': { accepts: ['movie.model.selected', 'movie.inference.requested'], transitions: { 'movie.model.selected': [], 'movie.inference.requested': ['movie.inference.started', 'movie.inference.completed'] } },
  'avatarx-analytics': { accepts: ['*'], transitions: {} }
});

export class MovieRuntimeError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export function validateMovieEvent(event, tenantId) {
  if (!tenantId) throw new MovieRuntimeError(401, 'TENANT_REQUIRED', 'x-tenant-id header is required');
  const required = ['id', 'type', 'source', 'tenantId', 'projectId', 'runId', 'traceId', 'correlationId', 'occurredAt'];
  for (const field of required) if (typeof event?.[field] !== 'string' || !event[field].trim()) throw new MovieRuntimeError(400, 'INVALID_MOVIE_EVENT', `${field} is required`);
  if (event.specversion !== EVENT_VERSION) throw new MovieRuntimeError(400, 'UNSUPPORTED_EVENT_VERSION', `specversion must be ${EVENT_VERSION}`);
  if (event.tenantId !== tenantId) throw new MovieRuntimeError(403, 'TENANT_SCOPE_MISMATCH', 'event tenant does not match authenticated tenant');
  if (Number.isNaN(Date.parse(event.occurredAt))) throw new MovieRuntimeError(400, 'INVALID_MOVIE_EVENT', 'occurredAt must be ISO-8601');
  if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) throw new MovieRuntimeError(400, 'INVALID_MOVIE_EVENT', 'data must be an object');
  return Object.freeze({ ...event });
}

export class InMemoryMovieEventStore {
  constructor() { this.inbox = new Map(); this.outbox = new Map(); this.runs = new Map(); }
  key(tenantId, eventId) { return `${tenantId}:${eventId}`; }
  async ingest(event, outputs, service) {
    const key = this.key(event.tenantId, event.id);
    if (this.inbox.has(key)) return { duplicate: true, ...this.inbox.get(key).result };
    const result = { accepted: true, eventId: event.id, runId: event.runId, emitted: outputs.map(item => item.type) };
    this.inbox.set(key, { event, service, status: 'processed', attempts: 1, result });
    this.runs.set(this.key(event.tenantId, event.runId), { tenantId: event.tenantId, projectId: event.projectId, runId: event.runId, lastEventType: event.type, traceId: event.traceId, updatedAt: new Date().toISOString() });
    for (const output of outputs) this.outbox.set(this.key(output.tenantId, output.id), { event: output, status: 'pending', attempts: 0, nextAttemptAt: new Date().toISOString() });
    return { duplicate: false, ...result };
  }
  async failOutbox(tenantId, eventId, error, maxAttempts = 5) {
    const row = this.outbox.get(this.key(tenantId, eventId)); if (!row) return null;
    row.attempts += 1; row.lastError = String(error?.message ?? error); row.status = row.attempts >= maxAttempts ? 'dead_letter' : 'pending';
    row.nextAttemptAt = new Date(Date.now() + Math.min(60_000, 1000 * 2 ** row.attempts)).toISOString(); return row;
  }
  async claimOutbox(limit = 25) {
    const now = Date.now(); const rows = [...this.outbox.values()].filter(row => row.status === 'pending' && Date.parse(row.nextAttemptAt) <= now).slice(0, limit); for (const row of rows) row.status = 'publishing'; return rows.map(row => row.event);
  }
  async markPublished(tenantId, eventId) { const row = this.outbox.get(this.key(tenantId, eventId)); if (row) { row.status = 'published'; row.publishedAt = new Date().toISOString(); } return row ?? null; }
  async listEvents({ tenantId, projectId, runId, limit = 50 }) {
const events = [...this.inbox.values()]
.map(row => row.event)
.filter(event =>
event.tenantId === tenantId &&
(!projectId || event.projectId === projectId) &&
(!runId || event.runId === runId)
)
.sort((a, b) =>
Date.parse(b.occurredAt) -
Date.parse(a.occurredAt)
)
.slice(0, limit);

return events;
}
async ready() { return true; }
}

export class PostgresMovieEventStore {
  constructor(pool) { this.pool = pool; }
  async ingest(event, outputs, service) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query('SELECT result FROM movie_event_inbox WHERE tenant_id=$1 AND event_id=$2 FOR UPDATE', [event.tenantId, event.id]);
      if (existing.rowCount) { await client.query('COMMIT'); return { duplicate: true, ...existing.rows[0].result }; }
      const result = { accepted: true, eventId: event.id, runId: event.runId, emitted: outputs.map(item => item.type) };
      await client.query('INSERT INTO movie_event_inbox(tenant_id,project_id,event_id,run_id,event_type,service,envelope,status,attempts,result,processed_at) VALUES($1,$2,$3,$4,$5,$6,$7,\'processed\',1,$8,now())', [event.tenantId,event.projectId,event.id,event.runId,event.type,service,event,result]);
      await client.query('INSERT INTO movie_pipeline_runs(tenant_id,project_id,run_id,last_event_type,trace_id,updated_at) VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(tenant_id,run_id) DO UPDATE SET project_id=EXCLUDED.project_id,last_event_type=EXCLUDED.last_event_type,trace_id=EXCLUDED.trace_id,updated_at=now()', [event.tenantId,event.projectId,event.runId,event.type,event.traceId]);
      for (const output of outputs) await client.query('INSERT INTO movie_event_outbox(tenant_id,project_id,event_id,run_id,event_type,envelope,status,next_attempt_at) VALUES($1,$2,$3,$4,$5,$6,\'pending\',now()) ON CONFLICT(tenant_id,event_id) DO NOTHING', [output.tenantId,output.projectId,output.id,output.runId,output.type,output]);
      await client.query('COMMIT'); return { duplicate: false, ...result };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async failOutbox(tenantId, eventId, error, maxAttempts = 5) {
    const result = await this.pool.query("UPDATE movie_event_outbox SET attempts=attempts+1,last_error=$3,status=CASE WHEN attempts+1 >= $4 THEN 'dead_letter' ELSE 'pending' END,next_attempt_at=now()+(LEAST(60,power(2,attempts+1))||' seconds')::interval WHERE tenant_id=$1 AND event_id=$2 RETURNING *", [tenantId,eventId,String(error?.message ?? error),maxAttempts]); return result.rows[0] ?? null;
  }
  async claimOutbox(limit = 25) {
    const result = await this.pool.query("WITH claimed AS (SELECT id FROM movie_event_outbox WHERE status='pending' AND next_attempt_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1) UPDATE movie_event_outbox o SET status='publishing',locked_at=now() FROM claimed WHERE o.id=claimed.id RETURNING o.envelope", [limit]); return result.rows.map(row => row.envelope);
  }
  async markPublished(tenantId, eventId) { const result = await this.pool.query("UPDATE movie_event_outbox SET status='published',published_at=now() WHERE tenant_id=$1 AND event_id=$2 RETURNING *", [tenantId,eventId]); return result.rows[0] ?? null; }
  async listEvents({ tenantId, projectId, runId, limit = 50 }) {
const values = [tenantId];
const clauses = ['tenant_id=$1'];

if (projectId) {
values.push(projectId);
clauses.push(`project_id=$${values.length}`);
}

if (runId) {
values.push(runId);
clauses.push(`run_id=$${values.length}`);
}

values.push(limit);

const result = await this.pool.query(
`SELECT envelope
FROM movie_event_inbox
WHERE ${clauses.join(' AND ')}
ORDER BY processed_at DESC
LIMIT $${values.length}`,
values
);

return result.rows.map(row => row.envelope);
}
async ready() { await this.pool.query('SELECT 1'); return true; }
}

function emittedEvent(input, type, service) {
  return { ...input, id: randomUUID(), type, source: service, causationId: input.id, occurredAt: new Date().toISOString(), data: { ...input.data, sourceEventType: input.type } };
}

export class MovieEventRuntime {
  constructor({ service, store = new InMemoryMovieEventStore(), maxRegenerations = 1 }) {
    if (!SERVICE_PROFILES[service]) throw new Error(`Unknown movie runtime service: ${service}`);
    this.service = service; this.profile = SERVICE_PROFILES[service]; this.store = store; this.maxRegenerations = maxRegenerations;
  }
  async ingest(input, tenantId) {
    const event = validateMovieEvent(input, tenantId);
    if (!this.profile.accepts.includes('*') && !this.profile.accepts.includes(event.type)) throw new MovieRuntimeError(422, 'EVENT_NOT_ACCEPTED', `${this.service} does not consume ${event.type}`);
    const transition = this.profile.transitions[event.type]; const types = typeof transition === 'function' ? transition({ event, maxRegenerations: this.maxRegenerations }) : (transition ?? []);
    return this.store.ingest(event, types.map(type => emittedEvent(event, type, this.service)), this.service);
  }
  async getEvents({ tenantId, projectId, runId, limit = 50 }) {
if (!tenantId) {
throw new MovieRuntimeError(
401,
'TENANT_REQUIRED',
'x-tenant-id header is required'
);
}

const parsedLimit = Number(limit);

if (
!Number.isInteger(parsedLimit) ||
parsedLimit < 1 ||
parsedLimit > 100
) {
throw new MovieRuntimeError(
400,
'INVALID_EVENT_LIMIT',
'limit must be an integer from 1 to 100'
);
}

return this.store.listEvents({
tenantId,
projectId,
runId,
limit: parsedLimit,
});
}
ready() { return this.store.ready(); }
}

async function configuredStore(store, env) {
  if (store) return store;
  const postgres = env.PERSISTENCE_BACKEND === 'postgres' || env.NODE_ENV === 'production';
  if (!postgres) return new InMemoryMovieEventStore();
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required for the movie runtime');
  const { Pool } = await import('pg'); return new PostgresMovieEventStore(new Pool({ connectionString: env.DATABASE_URL }));
}

export function createMovieRuntimeEndpoint({ service, store, maxRegenerations, env = process.env } = {}) {
  let runtime;
  const getRuntime = () => runtime ??= configuredStore(store, env).then(value => new MovieEventRuntime({ service, store: value, maxRegenerations }));
  return async function handle({ req, res, url, bodyText, tenantId, send, fail }) {
    if (req.method === 'GET' && url.pathname === '/ready/movie-runtime') {
      try { await (await getRuntime()).ready(); return send(res, 200, { status: 'ready', service, eventVersion: EVENT_VERSION }); } catch { return fail(res, 503, 'MOVIE_RUNTIME_NOT_READY', 'Movie runtime persistence is unavailable'); }
    }
    if (req.method === 'GET' && url.pathname === '/v1/movie-events') {
try {
const events = await (await getRuntime()).getEvents({
tenantId,
projectId:
url.searchParams.get('projectId') || undefined,
runId:
url.searchParams.get('runId') || undefined,
limit:
url.searchParams.get('limit') ?? 50,
});

send(res, 200, {
events,
count: events.length,
});
} catch (error) {
fail(
res,
error.status ?? 500,
error.code ?? 'MOVIE_RUNTIME_ERROR',
error.status
? error.message
: 'Movie event retrieval failed'
);
}

return true;
}

if (req.method !== 'POST' || url.pathname !== '/v1/movie-events') return false;
    try { let event; try { event = JSON.parse(bodyText || '{}'); } catch { throw new MovieRuntimeError(400, 'INVALID_JSON', 'Request body must be valid JSON'); } const result = await (await getRuntime()).ingest(event, tenantId); send(res, result.duplicate ? 200 : 202, result); }
    catch (error) { fail(res, error.status ?? 500, error.code ?? 'MOVIE_RUNTIME_ERROR', error.status ? error.message : 'Movie event processing failed'); }
    return true;
  };
}
