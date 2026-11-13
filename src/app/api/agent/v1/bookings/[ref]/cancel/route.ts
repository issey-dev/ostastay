import { agentRoute, requireAgent, jsonBody } from "@/lib/agent-api/http";
import { idempotent } from "@/lib/agent-api/idempotency";
import { cancelBooking } from "@/lib/agent-api/bookings";

// POST /bookings/{ref}/cancel  { reasonCode?, reason? } — a booking on option only; a reason is required.
export const POST = agentRoute<{ ref: string }>(async (ctx) => {
  const agent = requireAgent(ctx);
  const body = await jsonBody(ctx.request);
  return idempotent(ctx.request, ctx.key.id, body, async () => ({ status: 200, data: await cancelBooking(agent, ctx.propertyIds, ctx.params.ref, body) }));
});
