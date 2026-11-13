import { agentRoute, assertAgentProperty, requireAgent, jsonBody } from "@/lib/agent-api/http";
import { idempotent } from "@/lib/agent-api/idempotency";
import { requestSlot } from "@/lib/agent-api/bookings";

// POST /properties/{id}/slot-requests  { from, to, rooms: [{ roomTypeId, quantity }], note?, overflow? }
// Ask the hotel for a slot. It holds nothing until the hotel approves it. Idempotent.
export const POST = agentRoute<{ propertyId: string }>(async (ctx) => {
  assertAgentProperty(ctx, ctx.params.propertyId);
  const agent = requireAgent(ctx);
  const body = await jsonBody(ctx.request);
  return idempotent(ctx.request, ctx.key.id, body, async () => ({ status: 201, data: await requestSlot(agent, ctx.params.propertyId, body) }));
});
