import { agentRoute, apiJson, requireAgent } from "@/lib/agent-api/http";
import { agentLogout } from "@/lib/agent-api/auth";

// POST /api/agent/v1/auth/logout — revokes the current token.
export const POST = agentRoute(async (ctx) => {
  await agentLogout(requireAgent(ctx));
  return apiJson({ ok: true });
});
