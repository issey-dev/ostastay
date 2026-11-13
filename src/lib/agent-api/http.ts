import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ForbiddenError, UnauthorizedError } from "@/lib/scope";
import { resolveWebsiteApiKey, type ResolvedWebsiteKey } from "@/lib/website-api/resolve-key";
import { consumeRateLimit, rateLimitHeaders, type RateDecision } from "@/lib/website-api/rate-limit";
import { apiError, apiJson, requestIp, readJsonBody } from "@/lib/website-api/http";
import { keyHasScope } from "@/lib/website-api/scopes";
import { AgentAuthError, resolveAgentSession, type AgentIdentity } from "@/lib/agent-api/auth";
import { OptionError } from "@/lib/reservations/options";
import { SlotError } from "@/lib/groups/slot-requests";
import { OverflowError } from "@/lib/reservations/overflow";

// HTTP plumbing for the Agent API (/api/agent/v1/**; Agent Portal plan A-1…A-4, §6).
//
// Two layers on every call:
//   1. the API key (Authorization: Bearer wsk_…) with the AGENT scope — server-to-server
//      only, so no CORS: the portal's server calls this, never a browser;
//   2. the agent's session token (X-Agent-Token: agt_…) — every route except /auth/*.
// An agent sees only their own world: every query is filtered by the token's Source, and
// another Source's record answers 404, never 403 (W-2 rule). The property list is the
// key's ACTIVE properties that have the agent portal switched on, read live, so turning the
// switch off stops the API the same minute and leaves every booking intact.
//
// No requireSession() anywhere under /api/agent: route-permission-coverage.test.ts fails
// if one appears, and an agent token is never accepted by the staff session.

export const AGENT_API_VERSION = "v1";

export type AgentRouteContext<P> = {
  request: Request;
  key: ResolvedWebsiteKey;
  /** Null only on routes declared { auth: false } (sign-in, invite, password reset). */
  agent: AgentIdentity | null;
  /** Properties this agent may act on: the key's, with the agent portal switched on. */
  propertyIds: string[];
  params: P;
  ip: string | null;
};

export class AgentApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFound = (what = "Not found.") => new AgentApiError(404, "NOT_FOUND", what);

function rateLimited(d: RateDecision): NextResponse {
  return apiError(429, "RATE_LIMITED", "Too many requests. Slow down and retry after the time in Retry-After.", {
    headers: { ...rateLimitHeaders(d), "Retry-After": String(d.resetSeconds) },
  });
}

async function portalProperties(key: ResolvedWebsiteKey): Promise<string[]> {
  if (key.propertyIds.length === 0) return [];
  const rows = await prisma.propertySettings.findMany({
    where: { propertyId: { in: key.propertyIds }, agentPortalEnabled: true },
    select: { propertyId: true },
  });
  return rows.map((r) => r.propertyId);
}

export function agentRoute<P = Record<string, never>>(
  handler: (ctx: AgentRouteContext<P>) => Promise<NextResponse>,
  opts: { auth?: boolean } = {}
): (request: Request, context: { params: Promise<P> }) => Promise<NextResponse> {
  const needsAgent = opts.auth !== false;
  return async (request, context) => {
    try {
      const ip = requestIp(request);
      const resolved = await resolveWebsiteApiKey(request);
      if (!resolved.ok) {
        const failures = await consumeRateLimit("authFailure", ip ?? "unknown");
        if (!failures.allowed) return rateLimited(failures);
        return apiError(resolved.status, resolved.code, resolved.error);
      }
      const key = resolved.key;
      if (!keyHasScope(key, "AGENT")) {
        return apiError(403, "SCOPE_NOT_GRANTED", "This API key is not enabled for the agent portal. Ask the hotel to add it in the Hub.");
      }
      // A browser key can never carry AGENT (keys.ts), but refuse a cross-origin call outright.
      if (request.headers.get("origin") && key.allowedOrigins.length === 0) {
        return apiError(403, "SERVER_TO_SERVER_ONLY", "The Agent API is called from a server, not a browser.");
      }
      const quota = await consumeRateLimit(request.method === "GET" ? "read" : "write", key.id);
      if (!quota.allowed) return rateLimited(quota);

      let agent: AgentIdentity | null = null;
      if (needsAgent) {
        agent = await resolveAgentSession(request.headers.get("x-agent-token"), key.id, key.enterpriseId);
        if (!agent) {
          const failures = await consumeRateLimit("authFailure", ip ?? "unknown");
          if (!failures.allowed) return rateLimited(failures);
          return apiError(401, "AGENT_NOT_SIGNED_IN", "Sign in again: send the agent's token as X-Agent-Token.");
        }
      }
      const propertyIds = await portalProperties(key);
      const params = await context.params;
      const response = await handler({ request, key, agent, propertyIds, params, ip });
      for (const [name, value] of Object.entries(rateLimitHeaders(quota))) response.headers.set(name, value);
      return response;
    } catch (error) {
      if (error instanceof AgentApiError) return apiError(error.status, error.code, error.message, error.details !== undefined ? { details: error.details } : undefined);
      if (error instanceof AgentAuthError) return apiError(error.status, error.code, error.message);
      if (error instanceof SlotError) return apiError(error.status, error.code ?? "REFUSED", error.message, error.details !== undefined ? { details: error.details } : undefined);
      if (error instanceof OptionError || error instanceof OverflowError) return apiError(error.status, error.code ?? "REFUSED", error.message);
      if (error instanceof ForbiddenError) return apiError(404, "NOT_FOUND", "Not found.");
      if (error instanceof UnauthorizedError) return apiError(401, "UNAUTHORIZED", error.message);
      console.error("[agent-api]", error);
      return apiError(500, "INTERNAL_ERROR", "Internal server error.");
    }
  };
}

/** The property must be one this agent may act on; otherwise 404 (W-2). */
export function assertAgentProperty(ctx: Pick<AgentRouteContext<unknown>, "propertyIds">, propertyId: string) {
  if (!ctx.propertyIds.includes(propertyId)) throw notFound("Property not found.");
}

export function requireAgent(ctx: Pick<AgentRouteContext<unknown>, "agent">): AgentIdentity {
  if (!ctx.agent) throw new AgentApiError(401, "AGENT_NOT_SIGNED_IN", "Sign in first.");
  return ctx.agent;
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const b = await readJsonBody(request);
  if (b === null || typeof b !== "object" || Array.isArray(b)) throw new AgentApiError(400, "INVALID_BODY", "Send a JSON object.");
  return b as Record<string, unknown>;
}

export { apiJson };
