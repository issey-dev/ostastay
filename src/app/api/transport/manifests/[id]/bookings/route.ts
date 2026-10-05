import { NextResponse } from "next/server"
import { handle, opsGate, propertyIdFrom, readBody } from "@/lib/transport/http"
import { changeManifestBookings } from "@/lib/transport/manifests"

// POST /api/transport/manifests/{id}/bookings?propertyId= { action, bookingIds }
//   ATTACH — put bookings on this departure (moves them from another one)
//   DETACH — take them off
//   KEEP   — accept a changed flight time (clears the "flight changed" warning)
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    const body = await readBody(request)
    const propertyId = propertyIdFrom(request, body)
    const { actor } = await opsGate(propertyId, "update")
    return NextResponse.json(await changeManifestBookings(actor, propertyId, id, body))
  })
}
