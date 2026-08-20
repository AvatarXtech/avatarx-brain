import { runAvatar } from "../../../../lib/orchestrator";
import { identityFromRequest } from "../../../../lib/auth";

const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: { code: "INVALID_JSON", message: "The request body must be valid JSON." } }, { status: 400 }); }
  const identity = identityFromRequest(request, body.userId);
  if (!identity) return Response.json({ error: { code: "UNAUTHORIZED", message: "A valid user session is required." } }, { status: 401 });
  if (typeof body.avatarId !== "string" || typeof body.message !== "string" || !body.message.trim()) return Response.json({ error: { code: "INVALID_REQUEST", message: "avatarId and a non-empty message are required." } }, { status: 400 });
  if (body.message.length > 8000) return Response.json({ error: { code: "MESSAGE_TOO_LARGE", message: "Messages are limited to 8,000 characters." } }, { status: 413 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const traceId = crypto.randomUUID();
      controller.enqueue(encoder.encode(event("start", { traceId })));
      try {
        const result = await runAvatar({ userId: identity.userId, avatarId: body.avatarId as string, message: (body.message as string).trim(), remember: body.remember === true });
        const chunks = result.answer.match(/.{1,28}(?:\s|$)/g) ?? [result.answer];
        for (const chunk of chunks) { controller.enqueue(encoder.encode(event("delta", { text: chunk }))); }
        controller.enqueue(encoder.encode(event("done", result)));
      } catch { controller.enqueue(encoder.encode(event("error", { code: "RUN_FAILED", message: "The Avatar X run failed safely." }))); }
      finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
