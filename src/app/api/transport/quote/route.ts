import { NextResponse } from "next/server"
import { handle, opsGate, propertyIdFrom, readBody } from "@/lib/transport/http"
import { quoteBooking } from "@/lib/transport/bookings"

// POST /api/transport/quote?propertyId= — the rate a booking would get and what it comes to
// on the folio (tax included), computed by the real posting engine and rolled back.
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request)
    const propertyId = propertyIdFrom(request, body)
    await opsGate(propertyId, "view")
    return NextResponse.json(await quoteBooking(propertyId, body))
  })
}
