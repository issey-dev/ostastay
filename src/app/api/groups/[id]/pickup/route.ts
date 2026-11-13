import { NextResponse } from "next/server"
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope"
import { pickupIntoBlock } from "@/lib/groups/pickup"

// A desk pickup into a group block. Every rule (dates and elasticity, held rooms per night,
// stop sale, availability, sell limit, master folio, last-room lock, tentative pickups) lives
// in src/lib/groups/pickup.ts, shared with the Agent API.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, "GROUP_BLOCKS", "update")
    const { id } = await params
    const body = await request.json()
    const result = await pickupIntoBlock(ctx, id, {
      firstName: body.firstName,
      lastName: body.lastName,
      email: body.email,
      phone: body.phone,
      roomTypeId: body.roomTypeId,
      roomId: body.roomId,
      checkInDate: body.checkInDate,
      checkOutDate: body.checkOutDate,
      adults: body.adults,
      children: body.children,
      infants: body.infants,
      ratePlanId: body.ratePlanId,
      mealPlanCode: body.mealPlanCode,
      billToMaster: body.billToMaster,
      acknowledgeOverbook: body.acknowledgeOverbook === true,
      status: body.status === "TENTATIVE" ? "TENTATIVE" : "RESERVED",
    })
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, ...(result.code ? { code: result.code } : {}), ...(result.requiresOverbookConfirm ? { requiresOverbookConfirm: true } : {}) },
        { status: result.status }
      )
    }
    return NextResponse.json({
      ...result.reservation,
      ...(result.allocationWarning ? { allocationWarning: result.allocationWarning } : {}),
      ...(result.elastic ? { elastic: true } : {}),
    })
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
