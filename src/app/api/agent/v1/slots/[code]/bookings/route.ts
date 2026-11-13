import { agentRoute, requireAgent, jsonBody } from "@/lib/agent-api/http";
import { idempotent } from "@/lib/agent-api/idempotency";
import { createBookingsInSlot } from "@/lib/agent-api/bookings";

// POST /slots/{code}/bookings  { rooms: [{ roomTypeId, checkIn, checkOut, adults, children?,
//   leadGuest: { firstName, lastName, email?, phone? }, agentReference?, packageName?, requests?, mealPlan? }],
//   expectedTotal? }
// One or more rooms, all or nothing. Every booking starts on option (tentative) unless the hotel
// confirms this source's bookings automatically. expectedTotal guards against a price change.
export const POST = agentRoute<{ code: string }>(async (ctx) => {
  const agent = requireAgent(ctx);
  const body = await jsonBody(ctx.request);
  return idempotent(ctx.request, ctx.key.id, body, async () => ({
    status: 201,
    data: { bookings: await createBookingsInSlot(agent, ctx.propertyIds, ctx.params.code, body) },
  }));
});
