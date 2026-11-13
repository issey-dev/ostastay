import { agentRoute, apiJson, assertAgentProperty, requireAgent, AgentApiError } from "@/lib/agent-api/http";
import { agentStatement } from "@/lib/commission-ledger";

// GET /api/agent/v1/statement?propertyId&from=yyyy-MM-dd&to=yyyy-MM-dd
// Invoices (what the agent owes), commissions (what the hotel owes the agent), and the net.
// Per property (finance is per property); call once per property for an enterprise total.
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const GET = agentRoute(async (ctx) => {
  const agent = requireAgent(ctx);
  const u = new URL(ctx.request.url).searchParams;
  const propertyId = u.get("propertyId") ?? ctx.propertyIds[0] ?? "";
  assertAgentProperty(ctx, propertyId);
  const from = u.get("from") ?? "2000-01-01";
  const to = u.get("to") ?? new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (!DATE.test(from) || !DATE.test(to)) throw new AgentApiError(400, "INVALID_DATES", "Send from and to as yyyy-MM-dd.");
  return apiJson(await agentStatement(agent.sourceProfileId, propertyId, new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`)));
});
