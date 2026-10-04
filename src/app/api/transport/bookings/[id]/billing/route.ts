import { NextResponse } from "next/server"
import { handle, opsGate, propertyIdFrom, readBody } from "@/lib/transport/http"
import { billingAction } from "@/lib/transport/billing"

// POST /api/transport/bookings/{id}/billing?propertyId=
//   { action: "POST", mode: "FULL" }                          — post the transfer's price now
//   { action: "POST", mode: "CUSTOM", amount, reason, chargeCodeId?, description? } — a fee
//   { action: "WAIVE", reason } / { action: "RESUME" }         — don't bill / bill again
//   { action: "VOID", reason }                                 — void the posted charge
// POST/WAIVE/RESUME need TRANSPORTATION delete; VOID needs CASHIERING update (the folio rule).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params
    const body = await readBody(request)
    const propertyId = propertyIdFrom(request, body)
    const { actor } = await opsGate(propertyId, "view")
    return NextResponse.json(await billingAction(actor, propertyId, id, body))
  })
}
