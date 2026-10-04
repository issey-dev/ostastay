import { NextResponse } from "next/server"
import { catalogueGate, configGate, handle, propertyIdFrom, readBody } from "@/lib/transport/http"
import { deleteConfig, getConfig, isConfigEntity, updateConfig } from "@/lib/transport/config"
import { notFound } from "@/lib/transport/common"

// /api/transport/config/{entity}/{id}?propertyId=
//   GET    — one row
//   PATCH  — partial update; { isActive: false } deactivates (CONTROLS update)
//   DELETE — only while nothing references it, else 409 IN_USE (CONTROLS delete)
type Params = { params: Promise<{ entity: string; id: string }> }

export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { entity, id } = await params
    if (!isConfigEntity(entity)) throw notFound("Section")
    const propertyId = propertyIdFrom(request)
    await catalogueGate(propertyId)
    return NextResponse.json(await getConfig(propertyId, entity, id))
  })
}

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const { entity, id } = await params
    if (!isConfigEntity(entity)) throw notFound("Section")
    const body = await readBody(request)
    const propertyId = propertyIdFrom(request, body)
    const { actor } = await configGate(propertyId, "update")
    const patch = { ...(body as Record<string, unknown>) }
    delete patch.propertyId
    return NextResponse.json(await updateConfig(actor, propertyId, entity, id, patch))
  })
}

export async function DELETE(request: Request, { params }: Params) {
  return handle(async () => {
    const { entity, id } = await params
    if (!isConfigEntity(entity)) throw notFound("Section")
    const propertyId = propertyIdFrom(request)
    const { actor } = await configGate(propertyId, "delete")
    return NextResponse.json(await deleteConfig(actor, propertyId, entity, id))
  })
}
