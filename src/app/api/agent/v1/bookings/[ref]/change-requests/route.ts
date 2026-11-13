import { agentRoute, apiJson, requireAgent, jsonBody } from "@/lib/agent-api/http";
import { idempotent } from "@/lib/agent-api/idempotency";
import { createChangeRequest, getBooking } from "@/lib/agent-api/bookings";

// POST /bookings/{ref}/change-requests  { type: "AMEND" | "CANCEL", note?, reasonCode?, checkIn?, checkOut?, roomTypeId?, adults? }
// GET  /bookings/{ref}/change-requests
export const POST = agentRoute<{ ref: string }>(async (ctx) => {
  const agent = requireAgent(ctx);
  const body = await jsonBody(ctx.request);
  return idempotent(ctx.request, ctx.key.id, body, async () => ({ status: 201, data: await createChangeRequest(agent, ctx.propertyIds, ctx.params.ref, body) }));
});
export const GET = agentRoute<{ ref: string }>(async (ctx) => {
  const b = await getBooking(requireAgent(ctx), ctx.propertyIds, ctx.params.ref);
  return apiJson({ changeRequests: b.changeRequests });
});
