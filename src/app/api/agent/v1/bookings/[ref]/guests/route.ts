import { agentRoute, apiJson, requireAgent, jsonBody } from "@/lib/agent-api/http";
import { updateGuests } from "@/lib/agent-api/bookings";

// PATCH /bookings/{ref}/guests  { guests: [{ firstName, lastName?, nationality?, dateOfBirth?, email?, phone? }] } — replaces the accompanying guests.
export const PATCH = agentRoute<{ ref: string }>(async (ctx) => {
  const body = await jsonBody(ctx.request);
  return apiJson(await updateGuests(requireAgent(ctx), ctx.propertyIds, ctx.params.ref, body));
});
