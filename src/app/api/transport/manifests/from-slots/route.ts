import { NextResponse } from "next/server"
import { handle, opsGate, propertyIdFrom, readBody } from "@/lib/transport/http"
import { createManifestsFromSlots } from "@/lib/transport/manifests"

// POST /api/transport/manifests/from-slots?propertyId= { serviceDate, direction, routeId? } —
// create the day's departures from the routes' default departure times (skips existing).
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request)
    const propertyId = propertyIdFrom(request, body)
    const { actor } = await opsGate(propertyId, "update")
    return NextResponse.json(await createManifestsFromSlots(actor, propertyId, body))
  })
}
