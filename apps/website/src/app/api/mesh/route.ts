import { meshMetrics } from "../../../lib/orchestrator";

export async function GET() {
  return Response.json(await meshMetrics());
}
