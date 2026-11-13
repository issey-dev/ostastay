import { agentRoute, apiJson, assertAgentProperty, requireAgent } from "@/lib/agent-api/http";
import { agentPropertyDetail } from "@/lib/agent-api/catalogue";

// GET /api/agent/v1/properties/{id} — room types, meal plans, the agent's negotiated rates,
// option and guest-detail rules, cancellation reasons, whether transfers are bookable.
export const GET = agentRoute<{ propertyId: string }>(async (ctx) => {
  assertAgentProperty(ctx, ctx.params.propertyId);
  return apiJson(await agentPropertyDetail(requireAgent(ctx), ctx.params.propertyId));
});
