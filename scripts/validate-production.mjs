import { pathToFileURL } from 'node:url';

const insecure = /^(change-me|changeme|development|dev-secret|phase\d+-local|replace-with)/i;
const secretNames = ['SERVICE_AUTH_SECRET', 'AUTH_SECRET', 'TOOL_CAPABILITY_SECRET', 'PROVENANCE_SIGNING_SECRET'];
const databaseNames = ['AGENTS_DATABASE_URL', 'ANALYTICS_DATABASE_URL', 'BRAIN_DATABASE_URL', 'INTELLIGENCE_DATABASE_URL', 'KNOWLEDGE_DATABASE_URL', 'MEMORY_DATABASE_URL', 'NEURON_DATABASE_URL'];

export function validateProduction(env = process.env) {
  const errors = [];
  for (const name of secretNames) {
    const value = String(env[name] || '');
    if (!value) errors.push(`${name} is required`);
    else if (value.length < 32 || insecure.test(value)) errors.push(`${name} must be a non-default secret of at least 32 characters`);
  }
  if (env.AI_PROVIDER !== 'mock' && !env.AI_API_KEY) errors.push('AI_API_KEY is required for a non-mock AI provider');
  for (const name of databaseNames) {
    try {
      const url = new URL(env[name]);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.password) throw new Error();
    } catch { errors.push(`${name} must be a credentialed PostgreSQL URL`); }
  }
  try {
    const redis = new URL(env.REDIS_URL);
    if (!['redis:', 'rediss:'].includes(redis.protocol)) throw new Error();
  } catch { errors.push('REDIS_URL must be a valid Redis URL'); }
  if (env.MEMORY_ENCRYPTION_KEY) {
    let decoded;
    try { decoded = Buffer.from(env.MEMORY_ENCRYPTION_KEY, 'base64'); } catch {}
    if (!decoded || decoded.length !== 32) errors.push('MEMORY_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  } else errors.push('MEMORY_ENCRYPTION_KEY is required');
  if (errors.length) throw Object.assign(new Error(errors.join('; ')), { code: 'INVALID_PRODUCTION_CONFIG', errors });
  return { valid: true, provider: env.AI_PROVIDER || 'mock', checkedSecrets: secretNames.length, checkedDatabases: databaseNames.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(validateProduction(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ valid: false, code: error.code, errors: error.errors }, null, 2));
    process.exitCode = 1;
  }
}
