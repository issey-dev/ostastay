import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope"
import { logActivity } from "@/lib/activity-log"

export async function GET(request: Request) {
  try {
    const ctx = await requireSession()
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get("propertyId")

    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 })
    }
    await assertPropertyAccess(ctx, propertyId)

    const groups = await prisma.groupBlock.findMany({
      where: { propertyId },
      include: {
        reservations: true,
        masterFolios: true
      },
      orderBy: { startDate: 'asc' }
    })

    return NextResponse.json(groups)
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, "GROUP_BLOCKS", "create")

    const body = await request.json()
    const { propertyId, code, name, startDate, endDate, cutoffDate, totalRoomsHeld } = body
    // Per-room-type holds: [{ roomTypeId, quantity }]. When provided, they're the source
    // of truth and totalRoomsHeld is their sum; otherwise fall back to the flat number.
    const roomHolds: { roomTypeId: string; quantity: number }[] = Array.isArray(body.roomHolds)
      ? body.roomHolds
          .map((h: any) => ({ roomTypeId: String(h.roomTypeId), quantity: parseInt(h.quantity) || 0 }))
          .filter((h: { roomTypeId: string; quantity: number }) => h.roomTypeId && h.quantity > 0)
      : []
    const heldTotal = roomHolds.length
      ? roomHolds.reduce((s, h) => s + h.quantity, 0)
      : parseInt(totalRoomsHeld) || 0

    if (!propertyId || !code || !name || !startDate || !endDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }
    await assertPropertyAccess(ctx, propertyId)

    // Check if the group code is already used AT THIS PROPERTY (scoped, so it can't reveal
    // another tenant's codes).
    const existing = await prisma.groupBlock.findUnique({
      where: { propertyId_code: { propertyId, code } }
    })

    if (existing) {
      return NextResponse.json({ error: "Group code already exists" }, { status: 400 })
    }

    const newGroup = await prisma.groupBlock.create({
      data: {
        propertyId,
        code,
        name,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        cutoffDate: cutoffDate ? new Date(cutoffDate) : null,
        totalRoomsHeld: heldTotal,
        status: "TENTATIVE",
        roomHolds: roomHolds.length
          ? { create: roomHolds.map((h) => ({ roomTypeId: h.roomTypeId, quantity: h.quantity })) }
          : undefined,
      }
    })

    await logActivity({
      ctx,
      module: "GROUP_BLOCKS",
      action: "CREATE",
      entityType: "GroupBlock",
      entityId: newGroup.id,
      description: `Created group block ${code} "${name}" (${heldTotal} rooms held)`,
    })

    return NextResponse.json(newGroup)
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
