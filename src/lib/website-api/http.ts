import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ForbiddenError, UnauthorizedError } from "@/lib/scope";
import { resolveWebsiteApiKey, type ResolvedWebsiteKey } from "@/lib/website-api/resolve-key";

// HTTP plumbing for the public Website API (src/app/api/website/v1/**).
//
// Every response — success, validation error, thrown error — must carry the same CORS
// headers, or a browser-side caller sees an opaque network failure instead of the JSON
// error the server actually sent. That "every response" requirement is why this file has a
// route wrapper (websiteRoute) where the rest of the codebase deliberately does not: the
// session routes have no cross-origin caller and so nothing to add to a catch block. Keep
// the wrapper this small; authorization decisions live in resolve-key.ts, not here.

export const WEBSITE_API_VERSION = "v1";

const ALLOWED_METHODS = "GET, POST, OPTIONS";
const ALLOWED_HEADERS = "Authorization, Content-Type, X-Api-Key, Idempotency-Key";

/** Standard error body. `code` is stable and documented; `error` is for humans. */
export type WebsiteApiErrorBody = { error: string; code: string; details?: unknown };

export function corsHeadersFor(request: Request, allowedOrigins: readonly string[]): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function apiJson<T>(data: T, init?: { status?: number; headers?: Record<string, string> }): NextResponse {
  return NextResponse.json(data, {
    status: init?.status ?? 200,
    headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
  });
}

export function apiError(
  status: number,
  code: string,
  error: string,
  opts?: { details?: unknown; headers?: Record<string, string> }
): NextResponse {
  const body: WebsiteApiErrorBody = { error, code };
  if (opts?.details !== undefined) body.details = opts.details;
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...(opts?.headers ?? {}) },
  });
}

/**
 * Preflight. A browser sends OPTIONS WITHOUT the Authorization header, so the key cannot
 * be resolved here — instead the Origin is checked against every active key's allow-list.
 * That is not authorization (the real request still needs a valid key); it only decides
 * whether the browser is permitted to make the attempt at all.
 */
export async function websitePreflight(request: Request): Promise<NextResponse> {
  const origin = request.headers.get("origin");
  if (!origin) return new NextResponse(null, { status: 204 });
  const match = await prisma.websiteApiKey.findFirst({
    where: { status: "ACTIVE", allowedOrigins: { has: origin } },
    select: { id: true },
  });
  if (!match) return new NextResponse(null, { status: 204 });
  return new NextResponse(null, { status: 204, headers: corsHeadersFor(request, [origin]) });
}

export type WebsiteRouteContext<P> = {
  request: Request;
  key: ResolvedWebsiteKey;
  params: P;
  /** Attach to every response from this handler. */
  cors: Record<string, string>;
};

/**
 * Wrap a Website API handler: resolve the key, compute CORS headers, and turn anything
 * thrown into the standard error body. Handlers return NextResponse via apiJson/apiError
 * and pass `cors` through so the headers land on their responses too.
 */
export function websiteRoute<P = Record<string, never>>(
  handler: (ctx: WebsiteRouteContext<P>) => Promise<NextResponse>
): (request: Request, context: { params: Promise<P> }) => Promise<NextResponse> {
  return async (request, context) => {
    let cors: Record<string, string> = {};
    try {
      const auth = await resolveWebsiteApiKey(request);
      if (!auth.ok) {
        // The key is bad, so there is no allow-list to honour. A browser caller on a
        // legitimately-listed origin still gets a readable 401 because preflight passed
        // and this is a simple response with a permitted status.
        return apiError(auth.status, auth.code, auth.error);
      }
      cors = corsHeadersFor(request, auth.key.allowedOrigins);
      const params = await context.params;
      return await handler({ request, key: auth.key, params, cors });
    } catch (error) {
      // createReservation's assertPropertyAccess throws ForbiddenError for a property the
      // key cannot act on (pending approval, wrong enterprise). To the website that is
      // "not found" — same reason keyCanAccessProperty's callers answer 404.
      if (error instanceof ForbiddenError) {
        return apiError(404, "PROPERTY_NOT_FOUND", "Property not found.", { headers: cors });
      }
      if (error instanceof UnauthorizedError) {
        return apiError(401, "UNAUTHORIZED", error.message, { headers: cors });
      }
      console.error("[website-api]", error);
      return apiError(500, "INTERNAL_ERROR", "Internal server error.", { headers: cors });
    }
  };
}

/** Parse a JSON body, answering null (not a throw) for malformed or empty input. */
export async function readJsonBody(request: Request): Promise<unknown | null> {
  try {
    const text = await request.text();
    if (!text.trim()) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Best-effort client IP for the WebsiteBooking audit row. */
export function requestIp(request: Request): string | null {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim() || null;
  return request.headers.get("x-real-ip");
}
