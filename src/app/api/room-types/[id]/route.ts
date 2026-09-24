import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { z } from 'zod'
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from '@/lib/scope'
import { logActivity } from '@/lib/activity-log'
import { assertRoomTypeCapacity } from '@/lib/license'
import {
  assertRoomHeadroom,
  assertRoomTypeCodeFree,
  describeHistory,
  findInventoryHistory,
  hasHistory,
  inventoryErrorResponse,
  InventoryConflictError,
} from '@/lib/inventory-guards'

const featureSchema = z.object({
  category: z.enum(["BED_TYPE", "ROOM_VIEW", "ROOM_AMENITY"]),
  code: z.string().min(1),
})

const updateSchema = z.object({
  name: z.string().trim().min(2),
  code: z.string().trim().min(2),
  maxOccupancy: z.number().int().positive(),
  baseOccupancy: z.number().int().positive().optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  isPseudo: z.boolean().optional(),
  housekeepingEnabled: z.boolean().optional(),
  features: z.array(featureSchema).optional(),
})

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, 'CONTROLS', 'update')

    const { id } = await params;
    const json = await request.json()
    const { features, ...data } = updateSchema.parse(json)

    const existing = await prisma.roomType.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: "Room type not found" }, { status: 404 })
    }
    await assertPropertyAccess(ctx, existing.propertyId)

    // Base ≤ max, checked against the value that will actually be stored (baseOccupancy
    // may be omitted on an update, leaving the existing one in place).
    const effectiveBase = data.baseOccupancy ?? existing.baseOccupancy
    if (effectiveBase > data.maxOccupancy) {
      return NextResponse.json(
        { error: `Base occupancy (${effectiveBase}) cannot be more than max occupancy (${data.maxOccupancy})` },
        { status: 400 }
      )
    }

    await assertRoomTypeCodeFree(existing.propertyId, data.code, id)

    // A pseudo (PM) room type — and its rooms — sit outside the licence caps. Turning one
    // into a real room type makes it, and every room under it, count at once, so the same
    // caps that guard creation apply here.
    if (existing.isPseudo && data.isPseudo === false) {
      await assertRoomTypeCapacity(existing.propertyId)
      const roomCount = await prisma.room.count({ where: { roomTypeId: id } })
      await assertRoomHeadroom(existing.propertyId, roomCount)
    }

    const isBeingDeactivated = existing.isActive && data.isActive === false
    const isBeingReactivated = !existing.isActive && data.isActive === true
    let restoredRooms = 0

    const roomType = await prisma.$transaction(async (tx) => {
      const updated = await tx.roomType.update({
        where: { id },
        data: {
          ...data,
          ...(features !== undefined && {
            features: {
              deleteMany: {},
              create: features,
            },
          }),
        },
        include: { features: true },
      })

      // Deactivating a room type takes every one of its rooms out of service — never
      // deletes them, so reservation/folio history stays intact. Each room it moves
      // remembers the status it had in Room.statusBeforeTypeDeactivation, so that
      // re-activating can bring back exactly these rooms (and not one that was already
      // out of service for an unrelated reason). updateMany can't write a per-row value,
      // hence one update per distinct current status.
      if (isBeingDeactivated) {
        const statuses = await tx.room.findMany({
          where: { roomTypeId: id, status: { not: "OUT_OF_SERVICE" } },
          select: { status: true },
          distinct: ["status"],
        })
        for (const { status } of statuses) {
          await tx.room.updateMany({
            where: { roomTypeId: id, status },
            data: { status: "OUT_OF_SERVICE", statusBeforeTypeDeactivation: status },
          })
        }
      }

      // Re-activating (2026-09-24 — replaces the earlier "never auto-restore" rule, which
      // left every room of a re-activated type stuck out of service until someone found and
      // fixed each one by hand). Only rooms that the deactivation took out of service AND
      // that are still out of service are brought back:
      //   - one that was OUT_OF_ORDER goes back to OUT_OF_ORDER (its oooReason was never
      //     cleared, so the maintenance story is intact);
      //   - every other one goes to DIRTY, not its old CLEAN/INSPECTED — nobody has looked
      //     at the room since, so housekeeping must check it before it is sold (this keeps
      //     the owner's original concern: "was it actually cleaned/ready" isn't knowable).
      // A room someone has since set to another status manually had its marker cleared by
      // PATCH /api/rooms, so it is left alone. The marker is cleared on all of the type's
      // rooms afterwards either way.
      if (isBeingReactivated) {
        const toOoo = await tx.room.updateMany({
          where: { roomTypeId: id, status: "OUT_OF_SERVICE", statusBeforeTypeDeactivation: "OUT_OF_ORDER" },
          data: { status: "OUT_OF_ORDER" },
        })
        const toDirty = await tx.room.updateMany({
          where: {
            roomTypeId: id,
            status: "OUT_OF_SERVICE",
            statusBeforeTypeDeactivation: { not: null },
            NOT: { statusBeforeTypeDeactivation: "OUT_OF_ORDER" },
          },
          data: { status: "DIRTY" },
        })
        restoredRooms = toOoo.count + toDirty.count
        await tx.room.updateMany({
          where: { roomTypeId: id, statusBeforeTypeDeactivation: { not: null } },
          data: { statusBeforeTypeDeactivation: null },
        })
      }

      return updated
    })

    await logActivity({
      ctx,
      module: 'CONTROLS',
      action: 'UPDATE',
      entityType: 'RoomType',
      entityId: roomType.id,
      description: isBeingDeactivated
        ? `Deactivated room type "${roomType.name}" (${roomType.code}) — its rooms set to Out of Service`
        : isBeingReactivated
          ? `Re-activated room type "${roomType.name}" (${roomType.code}) — ${restoredRooms} room(s) brought back (set to Dirty for inspection)`
          : `Updated room type "${roomType.name}" (${roomType.code})`,
    })

    return NextResponse.json({ ...roomType, restoredRooms })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
    const { status, body } = inventoryErrorResponse(error, toErrorResponse, 'That room type code is already used in this property.')
    return NextResponse.json(body, { status })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, 'CONTROLS', 'delete')

    const { id } = await params;
    const existing = await prisma.roomType.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: "Room type not found" }, { status: 404 })
    }
    await assertPropertyAccess(ctx, existing.propertyId)

    // Check and delete in ONE transaction: refuse when any booking/block/ticket history
    // points at the type or its rooms (see src/lib/inventory-guards.ts), otherwise remove
    // the rooms and the type together — never the rooms alone.
    const deletedRooms = await prisma.$transaction(async (tx) => {
      const history = await findInventoryHistory(tx, { roomTypeIds: [id] })
      if (hasHistory(history)) {
        throw new InventoryConflictError(
          `Room type "${existing.name}" has ${describeHistory(history)} — make it inactive instead.`
        )
      }
      const { count } = await tx.room.deleteMany({ where: { roomTypeId: id } })
      await tx.roomType.delete({ where: { id } })
      return count
    })

    await logActivity({
      ctx,
      module: 'CONTROLS',
      action: 'DELETE',
      entityType: 'RoomType',
      entityId: id,
      description: `Deleted room type "${existing.name}" (${existing.code}) and its ${deletedRooms} room(s)`,
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    const { status, body } = inventoryErrorResponse(error, toErrorResponse)
    return NextResponse.json(body, { status })
  }
}
