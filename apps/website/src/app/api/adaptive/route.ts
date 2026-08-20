import { adaptiveMetrics } from "../../../lib/orchestrator";

export async function GET() {
  return Response.json(await adaptiveMetrics());
}
