import { reasoningMetrics } from "../../../lib/orchestrator";

export async function GET() {
  return Response.json(await reasoningMetrics());
}
