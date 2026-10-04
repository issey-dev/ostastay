import { NextResponse } from "next/server"
import { handle, opsGate, propertyIdFrom, readBody } from "@/lib/transport/http"
import { createManifest, listManifests } from "@/lib/transport/manifests"

// /api/transport/manifests?propertyId=
//   GET  — departures (from, to, direction, routeId, includeCancelled=1) — view
//   POST — create a departure, optionally with bookingIds attached — update (manage manifests)
export async function GET(request: Request) {
  return handle(async () => {
    const propertyId = propertyIdFrom(request)
    await opsGate(propertyId, "view")
    const sp = new URL(request.url).searchParams
    return NextResponse.json(
      await listManifests(propertyId, {
        from: sp.get("from"),
        to: sp.get("to"),
        direction: sp.get("direction"),
        routeId: sp.get("routeId"),
        includeCancelled: sp.get("includeCancelled") === "1",
      })
    )
  })
}

export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request)
    const propertyId = propertyIdFrom(request, body)
    const { actor } = await opsGate(propertyId, "update")
    return NextResponse.json(await createManifest(actor, propertyId, body), { status: 201 })
  })
}
