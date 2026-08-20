import { trustMetrics } from "../../../lib/orchestrator";

export async function GET() {
  return Response.json(await trustMetrics());
}
