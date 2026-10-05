import { NextResponse } from "next/server"
import { z } from "zod"
import { handle, opsGate, propertyIdFrom, readBody } from "@/lib/transport/http"
import { createDraftsFromSuggestions, transportSuggestions } from "@/lib/transport/bookings"
import { fromZod } from "@/lib/transport/common"
import { DATE_KEY } from "@/lib/transport/constants"

// /api/transport/suggestions?propertyId=&from=&to=
//   GET  — reservations arriving/departing with no transfer booked yet (view)
//   POST { items: [{ reservationId, direction }] } — create them as DRAFTS (create). Never
//        confirmed automatically; the desk reviews and confirms.
const q = z.object({ from: z.string().regex(DATE_KEY), to: z.string().regex(DATE_KEY) })
const body = z.object({
  items: z.array(z.object({ reservationId: z.string(), direction: z.enum(["PICKUP", "DROP_OFF"]) })).min(1).max(200),
})

export async function GET(request: Request) {
  return handle(async () => {
    const propertyId = propertyIdFrom(request)
    await opsGate(propertyId, "view")
    const sp = new URL(request.url).searchParams
    const parsed = q.safeParse({ from: sp.get("from"), to: sp.get("to") ?? sp.get("from") })
    if (!parsed.success) throw fromZod(parsed.error)
    return NextResponse.json(await transportSuggestions(propertyId, parsed.data.from, parsed.data.to))
  })
}

export async function POST(request: Request) {
  return handle(async () => {
    const raw = await readBody(request)
    const propertyId = propertyIdFrom(request, raw)
    const { actor } = await opsGate(propertyId, "create")
    const parsed = body.safeParse(raw)
    if (!parsed.success) throw fromZod(parsed.error)
    return NextResponse.json(await createDraftsFromSuggestions(actor, propertyId, parsed.data.items))
  })
}
