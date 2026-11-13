import { agentRoute, apiJson, jsonBody } from "@/lib/agent-api/http";
import { acceptInvite } from "@/lib/agent-api/auth";

// POST /api/agent/v1/auth/accept-invite  { token, password } → signed in.
export const POST = agentRoute(
  async ({ request, key, ip }) => {
    const body = await jsonBody(request);
    const s = await acceptInvite(key.enterpriseId, key.id, body.token, body.password, ip);
    return apiJson({ token: s.token, expiresAt: s.expiresAt.toISOString() }, { status: 201 });
  },
  { auth: false }
);
