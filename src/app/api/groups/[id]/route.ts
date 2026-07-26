import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope"
import { logActivity } from "@/lib/activity-log"
import { GROUP_STATUSES, GROUP_RELEASING_STATUSES, GROUP_STATUS_LABEL, canTransitionGroupStatus, type GroupStatus } from "@/lib/group-status"

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
        },
        roomHolds: {
          include: { roomType: { select: { id: true, name: true, code: true } } },
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
  status: z.enum(GROUP_STATUSES).optional(),
  startDate: z.string().min(1).optional(),
  endDate: z.string().min(1).optional(),
  cutoffDate: z.string().nullable().optional(),
  totalRoomsHeld: z.number().int().min(0).optional(),
  // Per-room-type holds — when provided, they replace the block's holds entirely and
  // totalRoomsHeld becomes their sum.
  roomHolds: z.array(z.object({ roomTypeId: z.string().min(1), quantity: z.number().int().min(0) })).optional(),
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

    // Enforce the status state machine (see src/lib/group-status.ts).
    if (data.status && data.status !== group.status && !canTransitionGroupStatus(group.status, data.status)) {
      return NextResponse.json(
        { error: `Cannot change status from ${GROUP_STATUS_LABEL[group.status as GroupStatus] ?? group.status} to ${GROUP_STATUS_LABEL[data.status]}.` },
        { status: 400 }
      )
    }

    const activePickups = await prisma.reservation.count({
      where: { groupBlockId: id, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
    })

    // Releasing a block (Lost / Cancelled) can't strand live pickups.
    if (data.status && GROUP_RELEASING_STATUSES.includes(data.status) && activePickups > 0) {
      const verb = data.status === "LOST" ? "mark lost" : "cancel"
      return NextResponse.json(
        { error: `Cannot ${verb} a block with ${activePickups} active pickup${activePickups > 1 ? "s" : ""} — cancel those reservations first.` },
        { status: 400 }
      )
    }
    // Per-type holds (when provided) are the source of truth; totalRoomsHeld is their sum.
    const cleanedHolds = data.roomHolds
      ? data.roomHolds.map((h) => ({ roomTypeId: h.roomTypeId, quantity: h.quantity })).filter((h) => h.quantity > 0)
      : null
    const effectiveHeld = cleanedHolds ? cleanedHolds.reduce((s, h) => s + h.quantity, 0) : data.totalRoomsHeld

    if (effectiveHeld != null && effectiveHeld < activePickups) {
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
        ...(effectiveHeld != null ? { totalRoomsHeld: effectiveHeld } : {}),
        // Replace the block's holds wholesale when a new set is supplied.
        ...(cleanedHolds ? { roomHolds: { deleteMany: {}, create: cleanedHolds } } : {}),
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
