import { agentRoute, requireAgent, jsonBody } from "@/lib/agent-api/http";
import { idempotent } from "@/lib/agent-api/idempotency";
import { requestConfirmation } from "@/lib/agent-api/bookings";

// POST /bookings/{ref}/request-confirmation  { note?, paymentReference? } — the hotel checks and confirms.
export const POST = agentRoute<{ ref: string }>(async (ctx) => {
  const agent = requireAgent(ctx);
  const body = await jsonBody(ctx.request);
  return idempotent(ctx.request, ctx.key.id, body, async () => ({ status: 200, data: await requestConfirmation(agent, ctx.propertyIds, ctx.params.ref, body) }));
});
