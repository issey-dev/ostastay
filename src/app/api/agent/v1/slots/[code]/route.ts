import { agentRoute, apiJson, requireAgent } from "@/lib/agent-api/http";
import { getSlot } from "@/lib/agent-api/bookings";

// GET /slots/{code} — asked for, approved, booked (tentative / confirmed), cutoff, checkpoints, flexibility.
export const GET = agentRoute<{ code: string }>(async (ctx) => apiJson(await getSlot(requireAgent(ctx), ctx.propertyIds, ctx.params.code)));
