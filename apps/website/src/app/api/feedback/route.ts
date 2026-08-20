import { identityFromRequest } from "../../../lib/auth";
import { submitRunFeedback } from "../../../lib/orchestrator";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: { code: "INVALID_JSON", message: "The request body must be valid JSON." } }, { status: 400 }); }
  if (!identityFromRequest(request, body.userId)) return Response.json({ error: { code: "UNAUTHORIZED", message: "A valid user session is required." } }, { status: 401 });
  if (typeof body.traceId !== "string" || typeof body.model !== "string" || ![-1, 1].includes(Number(body.score))) return Response.json({ error: { code: "INVALID_FEEDBACK", message: "traceId, model, and a score of -1 or 1 are required." } }, { status: 400 });
  const saved = await submitRunFeedback({ traceId: body.traceId, model: body.model, score: Number(body.score), citationIds: Array.isArray(body.citationIds) ? body.citationIds.filter((id): id is string => typeof id === "string").slice(0, 20) : [], comment: typeof body.comment === "string" ? body.comment.slice(0, 1000) : undefined });
  if (!saved) return Response.json({ error: { code: "FEEDBACK_UNAVAILABLE", message: "Feedback could not be recorded." } }, { status: 503 });
  return Response.json({ accepted: true });
}
