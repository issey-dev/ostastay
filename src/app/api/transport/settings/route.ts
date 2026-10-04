import { NextResponse } from "next/server"
import { configGate, catalogueGate, handle, propertyIdFrom, readBody } from "@/lib/transport/http"
import { getTransportSettings } from "@/lib/transport/common"
import { updateTransportSettings } from "@/lib/transport/config"

// GET/PATCH /api/transport/settings?propertyId= — the property's Transportation switch and
// defaults (Hub > the property > Transportation). Writing is property setup (CONTROLS).
export async function GET(request: Request) {
  return handle(async () => {
    const propertyId = propertyIdFrom(request)
    await catalogueGate(propertyId)
    return NextResponse.json(await getTransportSettings(propertyId))
  })
}

export async function PATCH(request: Request) {
  return handle(async () => {
    const body = await readBody(request)
    const propertyId = propertyIdFrom(request, body)
    const { actor } = await configGate(propertyId, "update")
    return NextResponse.json(await updateTransportSettings(actor, propertyId, body))
  })
}
