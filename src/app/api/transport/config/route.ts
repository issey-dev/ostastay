import { NextResponse } from "next/server"
import { catalogueGate, handle, propertyIdFrom } from "@/lib/transport/http"
import { configBundle } from "@/lib/transport/config"

// GET /api/transport/config?propertyId= — the whole catalogue plus settings, charge codes and
// tax profiles in one read: the Hub page and the booking form both start from it. Readable
// with CONTROLS (setup) or TRANSPORTATION (the desk picks routes and sees prices).
export async function GET(request: Request) {
  return handle(async () => {
    const propertyId = propertyIdFrom(request)
    await catalogueGate(propertyId)
    return NextResponse.json(await configBundle(propertyId))
  })
}
