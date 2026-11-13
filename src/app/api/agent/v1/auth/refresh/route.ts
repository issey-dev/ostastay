import { agentRoute, apiJson, requireAgent } from "@/lib/agent-api/http";
import { refreshAgentSession } from "@/lib/agent-api/auth";

// POST /api/agent/v1/auth/refresh — a fresh token for a live one; the old one stops working.
export const POST = agentRoute(async (ctx) => {
  const s = await refreshAgentSession(requireAgent(ctx), ctx.key.id, ctx.ip);
  return apiJson({ token: s.token, expiresAt: s.expiresAt.toISOString() });
});
