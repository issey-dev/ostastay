import { agentRoute, apiJson, requireAgent } from "@/lib/agent-api/http";
import { withdrawSlot } from "@/lib/agent-api/bookings";

// POST /slots/{code}/withdraw — while the hotel has not decided yet.
export const POST = agentRoute<{ code: string }>(async (ctx) => apiJson(await withdrawSlot(requireAgent(ctx), ctx.propertyIds, ctx.params.code)));
