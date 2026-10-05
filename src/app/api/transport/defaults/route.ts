import { NextResponse } from "next/server"
import { configGate, handle, propertyIdFrom, readBody } from "@/lib/transport/http"
import { loadTransportDefaults } from "@/lib/transport/config"

// POST /api/transport/defaults?propertyId= — add the standard transport types, the airport
// and the property as locations, and a Transportation charge code. Skips what exists.
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request)
    const propertyId = propertyIdFrom(request, body)
    const { actor } = await configGate(propertyId, "create")
    return NextResponse.json(await loadTransportDefaults(actor, propertyId))
  })
}
