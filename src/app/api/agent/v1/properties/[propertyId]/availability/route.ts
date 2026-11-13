import { agentRoute, apiJson, assertAgentProperty, requireAgent, AgentApiError } from "@/lib/agent-api/http";
import { agentAvailability } from "@/lib/agent-api/catalogue";
import { expireOptionsSoon } from "@/lib/reservations/options";
import { processCheckpointsSoon } from "@/lib/groups/release";

// GET /api/agent/v1/properties/{id}/availability?from=yyyy-MM-dd&to=yyyy-MM-dd
// Per room type per night: status, the house number capped ("5+"), the option forecast,
// the agent's own slot rooms left (exact) and their release date, and the nightly rate on
// the agent's negotiated plan (no other rate is ever shown).
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const GET = agentRoute<{ propertyId: string }>(async (ctx) => {
  assertAgentProperty(ctx, ctx.params.propertyId);
  const url = new URL(ctx.request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!DATE.test(from) || !DATE.test(to)) throw new AgentApiError(400, "INVALID_DATES", "Send from and to as yyyy-MM-dd.");
  await expireOptionsSoon(ctx.params.propertyId);
  await processCheckpointsSoon(ctx.params.propertyId);
  return apiJson(await agentAvailability(requireAgent(ctx), ctx.params.propertyId, new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`)));
});
