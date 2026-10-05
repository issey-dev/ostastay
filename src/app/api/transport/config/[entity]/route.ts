import { NextResponse } from "next/server"
import { catalogueGate, configGate, handle, propertyIdFrom, readBody } from "@/lib/transport/http"
import { createConfig, isConfigEntity, listConfig } from "@/lib/transport/config"
import { notFound } from "@/lib/transport/common"

// /api/transport/config/{types|locations|routes|providers|vessels|rates}?propertyId=
//   GET  — list (?active=1 for active only)
//   POST — create (CONTROLS create)
type Params = { params: Promise<{ entity: string }> }

export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { entity } = await params
    if (!isConfigEntity(entity)) throw notFound("Section")
    const propertyId = propertyIdFrom(request)
    await catalogueGate(propertyId)
    const activeOnly = new URL(request.url).searchParams.get("active") === "1"
    return NextResponse.json(await listConfig(propertyId, entity, { activeOnly }))
  })
}

export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { entity } = await params
    if (!isConfigEntity(entity)) throw notFound("Section")
    const body = await readBody(request)
    const propertyId = propertyIdFrom(request, body)
    const { actor } = await configGate(propertyId, "create")
    return NextResponse.json(await createConfig(actor, propertyId, entity, body), { status: 201 })
  })
}
