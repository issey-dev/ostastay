import { agentRoute, apiJson, requireAgent, jsonBody } from "@/lib/agent-api/http";
import { updateTravel } from "@/lib/agent-api/bookings";

// PATCH /bookings/{ref}/travel  { arrival?: { flight, time, domesticFlight?, transfer?, notes? } | null, departure?: … }
export const PATCH = agentRoute<{ ref: string }>(async (ctx) => {
  const body = await jsonBody(ctx.request);
  return apiJson(await updateTravel(requireAgent(ctx), ctx.propertyIds, ctx.params.ref, body));
});
