import http from 'node:http';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createMovieRuntimeEndpoint } from './movie-pipeline-runtime.mjs';

const env = process.env;
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
const fail = (res, status, code, message) => send(res, status, { error: { code, message } });
const raw = async req => { const chunks = []; for await (const chunk of req) chunks.push(chunk); return Buffer.concat(chunks).toString(); };

function verifyServiceAuth(req, body = '') {
  const secret = env.SERVICE_AUTH_SECRET;
  if (!secret) return { ok: true, service: 'development' };
  const service = req.headers['x-avatarx-service'];
  const timestamp = req.headers['x-avatarx-timestamp'];
  const signature = req.headers['x-avatarx-signature'];
  if (!service || !timestamp || !signature) return { ok: false, code: 'AUTH_REQUIRED', message: 'Signed service authentication is required' };
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 300000) return { ok: false, code: 'AUTH_TIMESTAMP_INVALID', message: 'Authentication timestamp is outside the allowed window' };
  const path = new URL(req.url, 'http://localhost').pathname;
  const digest = createHash('sha256').update(body).digest('hex');
  const expected = createHmac('sha256', secret).update(`${req.method}\n${path}\n${timestamp}\n${digest}`).digest('hex');
  const supplied = String(signature);
  if (supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return { ok: false, code: 'AUTH_SIGNATURE_INVALID', message: 'Service signature is invalid' };
  return { ok: true, service: String(service) };
}

const movieEvents = createMovieRuntimeEndpoint({ service: 'avatarx-brain', env, maxRegenerations: Number(env.MOVIE_MAX_REGENERATIONS ?? 1) });
export const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { status: 'ok', service: 'avatarx-brain' });
  try {
    const bodyText = await raw(req);
    const auth = verifyServiceAuth(req, bodyText);
    if (!auth.ok) return fail(res, 401, auth.code, auth.message);
    const url = new URL(req.url, 'http://localhost');
    const rawTenant = req.headers['x-tenant-id'] ?? req.headers['x-avatarx-tenant'];
    const tenantId = Array.isArray(rawTenant) ? rawTenant[0] : rawTenant;
    if (await movieEvents({ req, res, url, bodyText, tenantId, send, fail })) return;
    return fail(res, 404, 'NOT_FOUND', 'Route not found');
  } catch (error) {
    return fail(res, error.status ?? 500, error.code ?? 'INTERNAL_ERROR', error.status ? error.message : 'Internal server error');
  }
});

if (process.env.NODE_ENV !== 'test') {
  const port = Number(env.MOVIE_RUNTIME_PORT ?? 4110);
  server.listen(port, () => console.log(`avatarx-brain movie runtime listening on :${port}`));
}
