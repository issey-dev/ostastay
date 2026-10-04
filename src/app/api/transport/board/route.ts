import { NextResponse } from "next/server"
import { bookingFiltersFrom, handle, opsGate, propertyIdFrom } from "@/lib/transport/http"
import { boardData } from "@/lib/transport/board"
import { invalid } from "@/lib/transport/common"
import { DATE_KEY } from "@/lib/transport/constants"

// GET /api/transport/board?propertyId=&date=yyyy-MM-dd[&filters] — the day's bookings and
// departures plus the week strip's counts. TRANSPORTATION view.
export async function GET(request: Request) {
  return handle(async () => {
    const propertyId = propertyIdFrom(request)
    await opsGate(propertyId, "view")
    const sp = new URL(request.url).searchParams
    const date = sp.get("date") ?? ""
    if (!DATE_KEY.test(date)) throw invalid("date is required (yyyy-MM-dd)")
    return NextResponse.json(await boardData(propertyId, date, bookingFiltersFrom(sp)))
  })
}
