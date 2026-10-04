import { NextResponse } from "next/server"
import { handle, opsGate, propertyIdFrom, readBody } from "@/lib/transport/http"
import { setBookingStatus } from "@/lib/transport/bookings"

// POST /api/transport/bookings/{id}/status?propertyId= { status, reason? } — confirm, assign,
// complete, mark no-show, cancel, reinstate. Booking staff (create) or dispatch (update).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    const body = await readBody(request)
    const propertyId = propertyIdFrom(request, body)
    const { actor } = await opsGate(propertyId, ["create", "update"])
    return NextResponse.json(await setBookingStatus(actor, propertyId, id, body))
  })
}
