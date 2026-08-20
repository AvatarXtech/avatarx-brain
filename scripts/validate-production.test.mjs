import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProduction } from './validate-production.mjs';

const strong = 'a-strong-random-secret-that-is-longer-than-thirty-two';
const valid = {
  SERVICE_AUTH_SECRET: strong,
  AUTH_SECRET: strong + '-auth',
  TOOL_CAPABILITY_SECRET: strong + '-tools',
  PROVENANCE_SIGNING_SECRET: strong + '-provenance',
  MEMORY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  AI_PROVIDER: 'mock'
};

test('accepts a complete production configuration', () => assert.equal(validateProduction(valid).valid, true));
test('rejects defaults and missing encryption', () => assert.throws(() => validateProduction({ ...valid, SERVICE_AUTH_SECRET: 'phase2-local-service-secret', MEMORY_ENCRYPTION_KEY: '' }), { code: 'INVALID_PRODUCTION_CONFIG' }));
test('requires a provider key outside mock mode', () => assert.throws(() => validateProduction({ ...valid, AI_PROVIDER: 'openai-compatible' }), { code: 'INVALID_PRODUCTION_CONFIG' }));
