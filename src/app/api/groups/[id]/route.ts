import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope"
import { logActivity } from "@/lib/activity-log"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession()
    const { id } = await params
    const group = await prisma.groupBlock.findUnique({
      where: { id },
      include: {
        reservations: {
          include: {
            primaryGuest: true,
            assignments: {
              include: {
                roomType: true,
                room: true
              }
            }
          }
        },
        masterFolios: {
          include: {
            lineItems: {
              include: { chargeCode: true }
            },
            payments: {
              include: { paymentMethod: true }
            }
          }
        }
      }
    })

    if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 })
    await assertPropertyAccess(ctx, group.propertyId)

    return NextResponse.json(group)
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(["TENTATIVE", "DEFINITE", "CANCELLED"]).optional(),
  startDate: z.string().min(1).optional(),
  endDate: z.string().min(1).optional(),
  cutoffDate: z.string().nullable().optional(),
  totalRoomsHeld: z.number().int().min(0).optional(),
})

// A block was previously frozen at creation — status, cutoff, and rooms-held could
// never change, even though pickup logic guards on all three. Guards here: rooms
// held can't shrink below what's already picked up, and a block with active
// pickups can't be cancelled out from under them.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, "GROUP_BLOCKS", "update")
    const { id } = await params

    const parsed = updateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid group update payload", details: parsed.error.flatten() }, { status: 400 })
    }
    const data = parsed.data

    const group = await prisma.groupBlock.findUnique({ where: { id } })
    if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 })
    await assertPropertyAccess(ctx, group.propertyId)

    const activePickups = await prisma.reservation.count({
      where: { groupBlockId: id, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
    })

    if (data.status === "CANCELLED" && activePickups > 0) {
      return NextResponse.json(
        { error: `Cannot cancel a block with ${activePickups} active pickup${activePickups > 1 ? "s" : ""} — cancel those reservations first.` },
        { status: 400 }
      )
    }
    if (data.totalRoomsHeld != null && data.totalRoomsHeld < activePickups) {
      return NextResponse.json(
        { error: `Rooms held cannot go below the ${activePickups} already picked up.` },
        { status: 400 }
      )
    }

    const startDate = data.startDate ? new Date(data.startDate) : group.startDate
    const endDate = data.endDate ? new Date(data.endDate) : group.endDate
    if (endDate <= startDate) {
      return NextResponse.json({ error: "End date must be after start date" }, { status: 400 })
    }

    const updated = await prisma.groupBlock.update({
      where: { id },
      data: {
        ...(data.name != null ? { name: data.name } : {}),
        ...(data.status != null ? { status: data.status } : {}),
        ...(data.startDate != null ? { startDate } : {}),
        ...(data.endDate != null ? { endDate } : {}),
        ...(data.cutoffDate !== undefined
          ? { cutoffDate: data.cutoffDate ? new Date(data.cutoffDate) : null }
          : {}),
        ...(data.totalRoomsHeld != null ? { totalRoomsHeld: data.totalRoomsHeld } : {}),
      },
    })

    await logActivity({
      ctx,
      module: "GROUP_BLOCKS",
      action: "UPDATE",
      entityType: "GroupBlock",
      entityId: id,
      description:
        `Updated group block ${group.code}` +
        (data.status && data.status !== group.status ? ` — status ${group.status} → ${data.status}` : "") +
        (data.totalRoomsHeld != null && data.totalRoomsHeld !== group.totalRoomsHeld
          ? ` — rooms held ${group.totalRoomsHeld} → ${data.totalRoomsHeld}`
          : ""),
    })

    return NextResponse.json(updated)
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
