import { agentRoute, apiJson, requireAgent } from "@/lib/agent-api/http";
import { agentMe } from "@/lib/agent-api/catalogue";

// GET /api/agent/v1/me — the signed-in agent, their Source's terms, and the properties
// (with the rates negotiated for them) they may work with.
export const GET = agentRoute(async (ctx) => apiJson(await agentMe(requireAgent(ctx), ctx.propertyIds)));
