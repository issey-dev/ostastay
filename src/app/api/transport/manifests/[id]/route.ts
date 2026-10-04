import { NextResponse } from "next/server"
import { handle, opsGate, propertyIdFrom, readBody } from "@/lib/transport/http"
import { getManifest, updateManifest } from "@/lib/transport/manifests"

// /api/transport/manifests/{id}?propertyId= — GET (view) with its passengers and totals;
// PATCH (update): time, provider, vessel, driver, notes, status (COMPLETED completes its
// bookings; CANCELLED releases them to be put on another departure).
type Params = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params
    const propertyId = propertyIdFrom(request)
    await opsGate(propertyId, "view")
    return NextResponse.json(await getManifest(propertyId, id))
  })
}

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params
    const body = await readBody(request)
    const propertyId = propertyIdFrom(request, body)
    const { actor } = await opsGate(propertyId, "update")
    return NextResponse.json(await updateManifest(actor, propertyId, id, body))
  })
}
