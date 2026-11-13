import { agentRoute, apiJson, assertAgentProperty, requireAgent, jsonBody } from "@/lib/agent-api/http";
import { agentQuote } from "@/lib/agent-api/catalogue";

// POST /api/agent/v1/properties/{id}/quote  { roomTypeId, checkIn, checkOut, adults?, children?,
// ratePlanId?, mealPlan? } → the authoritative total on the agent's negotiated plan and the
// commission estimate (on the room rate without service charge and tax).
export const POST = agentRoute<{ propertyId: string }>(async (ctx) => {
  assertAgentProperty(ctx, ctx.params.propertyId);
  const body = await jsonBody(ctx.request);
  return apiJson(await agentQuote(requireAgent(ctx), ctx.params.propertyId, body as Parameters<typeof agentQuote>[2]));
});
