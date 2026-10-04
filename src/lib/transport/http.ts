import { NextResponse } from "next/server"
import { BookingError, bookingErrorResponse } from "@/lib/booking-error"
import {
  assertPropertyAccess,
  hasPermission,
  requirePermission,
  requirePropertySetup,
  requireSession,
  toErrorResponse,
  ForbiddenError,
  type Action,
  type AuthContext,
} from "@/lib/scope"
import { assertTransportEnabled, sessionActor, type TransportActor } from "@/lib/transport/common"

// Session-route plumbing for /api/transport/** (the desk). Two gates, the Excursions split:
//   config — the Hub section: requirePropertySetup(…, "CONTROLS", action)
//   ops    — the module: property access + TRANSPORTATION permission + module switched on
// Services throw BookingError; this maps it to the session routes' `{ error, code }` shape.

export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof BookingError) return bookingErrorResponse(e)
    const { status, body } = toErrorResponse(e)
    return NextResponse.json(body, { status })
  }
}

export function propertyIdFrom(request: Request, body?: unknown): string {
  const fromQuery = new URL(request.url).searchParams.get("propertyId")
  const fromBody = body && typeof body === "object" ? (body as { propertyId?: unknown }).propertyId : undefined
  const id = fromQuery || (typeof fromBody === "string" ? fromBody : "")
  if (!id) throw new BookingError(400, "VALIDATION", "propertyId is required")
  return id
}

export async function readBody(request: Request): Promise<unknown> {
  return request.json().catch(() => ({}))
}

export async function configGate(propertyId: string, action: Action): Promise<{ ctx: AuthContext; actor: TransportActor }> {
  const ctx = await requireSession()
  await requirePropertySetup(ctx, propertyId, "CONTROLS", action)
  return { ctx, actor: sessionActor(ctx) }
}

/** Ops gate. `actions` = any of these TRANSPORTATION actions is enough. */
export async function opsGate(
  propertyId: string,
  actions: Action | Action[]
): Promise<{ ctx: AuthContext; actor: TransportActor }> {
  const ctx = await requireSession()
  await assertPropertyAccess(ctx, propertyId)
  const list = Array.isArray(actions) ? actions : [actions]
  if (list.length === 1) requirePermission(ctx, "TRANSPORTATION", list[0])
  else if (!list.some((a) => hasPermission(ctx, "TRANSPORTATION", a))) {
    throw new ForbiddenError(`Missing ${list.join(" or ")} permission on TRANSPORTATION`)
  }
  await assertTransportEnabled(propertyId)
  return { ctx, actor: sessionActor(ctx) }
}

/** Read access to the catalogue: the Hub (CONTROLS) or the desk (TRANSPORTATION). */
export async function catalogueGate(propertyId: string): Promise<{ ctx: AuthContext; actor: TransportActor }> {
  const ctx = await requireSession()
  await assertPropertyAccess(ctx, propertyId)
  if (!hasPermission(ctx, "CONTROLS", "view") && !hasPermission(ctx, "TRANSPORTATION", "view")) {
    throw new ForbiddenError("Not authorized to view transportation setup")
  }
  return { ctx, actor: sessionActor(ctx) }
}

/** Booking list filters from a query string (the board and the bookings list). */
export function bookingFiltersFrom(sp: URLSearchParams) {
  const s = (k: string) => sp.get(k) || null
  return {
    from: s("from"),
    to: s("to"),
    direction: s("direction"),
    status: sp.getAll("status").filter(Boolean),
    reservationId: s("reservationId"),
    manifestId: s("manifestId"),
    transportTypeId: s("transportTypeId"),
    routeId: s("routeId"),
    providerId: s("providerId"),
    airportRepUserId: s("airportRepUserId"),
    groupBlockId: s("groupBlockId"),
    flightNo: s("flightNo"),
    search: s("q"),
    unassignedOnly: sp.get("unassigned") === "1",
    attentionOnly: sp.get("attention") === "1",
    includeCancelled: sp.get("includeCancelled") === "1",
    limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
    cursor: s("cursor"),
  }
}
