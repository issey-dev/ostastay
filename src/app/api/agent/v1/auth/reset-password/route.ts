import { agentRoute, apiJson, jsonBody } from "@/lib/agent-api/http";
import { resetPassword } from "@/lib/agent-api/auth";

// POST /api/agent/v1/auth/reset-password  { token, password } — signs every device out.
export const POST = agentRoute(
  async ({ request, key }) => {
    const body = await jsonBody(request);
    await resetPassword(key.enterpriseId, body.token, body.password);
    return apiJson({ ok: true });
  },
  { auth: false }
);
