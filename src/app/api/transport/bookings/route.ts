import { NextResponse } from "next/server"
import { bookingFiltersFrom, handle, opsGate, propertyIdFrom, readBody } from "@/lib/transport/http"
import { createBooking, listBookings } from "@/lib/transport/bookings"

// /api/transport/bookings?propertyId=
//   GET  — list (from, to, direction, status, reservationId, manifestId, q, unassigned=1,
//          attention=1, limit, cursor…) — TRANSPORTATION view
//   POST — create (reservation-linked, or standalone with guestName) — TRANSPORTATION create
export async function GET(request: Request) {
  return handle(async () => {
    const propertyId = propertyIdFrom(request)
    await opsGate(propertyId, "view")
    return NextResponse.json(await listBookings(propertyId, bookingFiltersFrom(new URL(request.url).searchParams)))
  })
}

export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request)
    const propertyId = propertyIdFrom(request, body)
    const { actor } = await opsGate(propertyId, "create")
    return NextResponse.json(await createBooking(actor, propertyId, body), { status: 201 })
  })
}
