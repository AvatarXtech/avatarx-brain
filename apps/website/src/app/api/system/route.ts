import { NextResponse } from "next/server";
import { systemHealth } from "../../../lib/orchestrator";

export async function GET() { return NextResponse.json({ service: "avatarx-brain", status: "online", services: await systemHealth() }); }
