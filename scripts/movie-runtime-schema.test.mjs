import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresMovieEventStore, SERVICE_SCHEMAS } from './movie-pipeline-runtime.mjs';

test('avatarx-brain qualifies every runtime table with its owned schema', async () => {
  const queries = [];
  const pool = { query: async text => { queries.push(text); return { rows: [] }; } };
  const store = new PostgresMovieEventStore(pool, { schema: SERVICE_SCHEMAS['avatarx-brain'] });
  assert.equal(store.table('movie_event_inbox'), '"brain"."movie_event_inbox"');
  await store.claimOutbox(1);
  assert.match(queries[0], /"brain"\."movie_event_outbox"/);
});

test('avatarx-brain rejects unsafe schema identifiers', () => {
  assert.throws(() => new PostgresMovieEventStore({}, { schema: 'public;drop schema public' }), /safe service-owned/);
});
