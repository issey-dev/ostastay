import { agentRoute, apiJson, requireAgent, jsonBody } from "@/lib/agent-api/http";
import { updateRequests } from "@/lib/agent-api/bookings";

// PATCH /bookings/{ref}/requests  { packageName?, agentReference?, requests? }
export const PATCH = agentRoute<{ ref: string }>(async (ctx) => {
  const body = await jsonBody(ctx.request);
  return apiJson(await updateRequests(requireAgent(ctx), ctx.propertyIds, ctx.params.ref, body));
});
