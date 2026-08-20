import { identityFromRequest } from "../../../../lib/auth";
import { decideImprovement } from "../../../../lib/orchestrator";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: { code: "INVALID_JSON", message: "The request body must be valid JSON." } }, { status: 400 }); }
  const identity = identityFromRequest(request, body.userId);
  if (!identity || !identity.roles.includes("operator")) return Response.json({ error: { code: "FORBIDDEN", message: "Operator approval is required." } }, { status: 403 });
  if (!['approved', 'rejected'].includes(String(body.decision)) || typeof body.rationale !== "string" || !body.rationale.trim()) return Response.json({ error: { code: "INVALID_DECISION", message: "An approved/rejected decision and rationale are required." } }, { status: 400 });
  const { id } = await context.params;
  const result = await decideImprovement({ id, decision: body.decision as "approved" | "rejected", decidedBy: identity.userId, rationale: body.rationale.slice(0, 2000) });
  if (!result) return Response.json({ error: { code: "DECISION_UNAVAILABLE", message: "The improvement decision could not be recorded." } }, { status: 503 });
  return Response.json(result);
}
