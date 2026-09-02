import test from 'node:test';
import assert from 'node:assert/strict';
import { createMovieEvent, movieEventDeduplicationKey, validateMovieEvent } from './movie-pipeline-contract.mjs';

test('avatarx-brain accepts its declared input and rejects unrelated input', () => {
  const base={specversion:'1.0',id:'evt-1',source:'avatarx-ai-director',tenantId:'tenant-1',projectId:'project-1',traceId:'trace-1',occurredAt:new Date().toISOString(),data:{}};
  assert.equal(validateMovieEvent({...base,type:'movie.production.initialized'}).ok,true);
  assert.equal(validateMovieEvent({...base,type:'movie.unrelated.created'}).ok,false);
});

test('avatarx-brain creates traceable output and stable deduplication key', () => {
  const event=createMovieEvent('movie.pipeline.commanded',{tenantId:'tenant-1',projectId:'project-1',traceId:'trace-1',idempotencyKey:'idem-1'},{status:'ok'});
  assert.equal(event.source,'avatarx-brain');
  assert.equal(event.data.status,'ok');
  assert.equal(movieEventDeduplicationKey({...event,type:'movie.production.initialized'}),'tenant-1:idem-1');
});
