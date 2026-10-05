import { NextResponse } from "next/server"
import { handle, opsGate, propertyIdFrom, readBody } from "@/lib/transport/http"
import { getBooking, updateBooking } from "@/lib/transport/bookings"

// /api/transport/bookings/{id}?propertyId= — GET one (view), PATCH edit (create = manage bookings).
type Params = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params
    const propertyId = propertyIdFrom(request)
    await opsGate(propertyId, "view")
    return NextResponse.json(await getBooking(propertyId, id))
  })
}

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params
    const body = await readBody(request)
    const propertyId = propertyIdFrom(request, body)
    const { actor } = await opsGate(propertyId, "create")
    return NextResponse.json(await updateBooking(actor, propertyId, id, body))
  })
}
