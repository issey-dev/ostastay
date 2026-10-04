import { NextResponse } from "next/server"
import { hasPermission } from "@/lib/scope"
import { handle, opsGate, propertyIdFrom, readBody } from "@/lib/transport/http"
import { bulkAction } from "@/lib/transport/bulk"

// POST /api/transport/bookings/bulk?propertyId= — the board's bulk actions:
//   { action: "STATUS", bookingIds, status, reason? } | { action: "ASSIGN_REP", bookingIds, airportRepUserId }
//   { action: "CONFIRM_DRAFTS", bookingIds } | { action: "POST", bookingIds }  (POST needs billing)
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request)
    const propertyId = propertyIdFrom(request, body)
    const { ctx, actor } = await opsGate(propertyId, "view")
    const manage = hasPermission(ctx, "TRANSPORTATION", "create") || hasPermission(ctx, "TRANSPORTATION", "update")
    return NextResponse.json(await bulkAction(actor, propertyId, body, { manage }))
  })
}
