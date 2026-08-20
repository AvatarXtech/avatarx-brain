import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export type Identity = { userId: string; tenantId: string; roles: string[] };

export function identityFromRequest(request: Request, fallbackUserId?: unknown): Identity | null {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return typeof fallbackUserId === "string" && fallbackUserId.trim() ? { userId: fallbackUserId.trim(), tenantId: "phase7-dev", roles: ["operator"] } : null;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const claims = JSON.parse(Buffer.from(encoded, "base64url").toString()) as { sub?: string; tenant?: string; roles?: string[]; exp?: number };
    if (!claims.sub || !claims.tenant || !claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return { userId: claims.sub, tenantId: claims.tenant, roles: Array.isArray(claims.roles) ? claims.roles : [] };
  } catch { return null; }
}
