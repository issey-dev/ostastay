import { agentRoute, apiJson, jsonBody } from "@/lib/agent-api/http";
import { agentLogin } from "@/lib/agent-api/auth";
import { consumeRateLimit, rateLimitHeaders } from "@/lib/website-api/rate-limit";
import { apiError } from "@/lib/website-api/http";

// POST /api/agent/v1/auth/login  { email, password } → { token, expiresAt }
// Rate limited per account and per IP; one answer for every failure (Agent Portal plan §9).
export const POST = agentRoute(
  async ({ request, key, ip }) => {
    const body = await jsonBody(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    for (const subject of [`ip:${ip ?? "unknown"}`, `acct:${key.enterpriseId}:${email}`]) {
      const d = await consumeRateLimit("agentLogin", subject);
      if (!d.allowed) {
        return apiError(429, "RATE_LIMITED", "Too many sign-in attempts. Wait a minute and try again.", {
          headers: { ...rateLimitHeaders(d), "Retry-After": String(d.resetSeconds) },
        });
      }
    }
    const session = await agentLogin(key.enterpriseId, key.id, email, body.password, ip);
    return apiJson({ token: session.token, expiresAt: session.expiresAt.toISOString() });
  },
  { auth: false }
);
