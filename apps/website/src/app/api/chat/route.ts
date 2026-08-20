import { NextResponse } from "next/server";
import { runAvatar } from "../../../lib/orchestrator";
import { identityFromRequest } from "../../../lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const identity = identityFromRequest(request, body.userId);
    if (!identity) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "A valid user session is required." } }, { status: 401 });
    if (typeof body.avatarId !== "string" || typeof body.message !== "string" || !body.message.trim()) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "avatarId and a non-empty message are required." } }, { status: 400 });
    if (body.message.length > 8000) return NextResponse.json({ error: { code: "MESSAGE_TOO_LARGE", message: "Messages are limited to 8,000 characters." } }, { status: 413 });
    return NextResponse.json(await runAvatar({ userId: identity.userId, avatarId: body.avatarId, message: body.message.trim(), remember: body.remember === true }));
  } catch { return NextResponse.json({ error: { code: "INVALID_JSON", message: "The request body must be valid JSON." } }, { status: 400 }); }
}
