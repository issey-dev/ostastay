import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope"
import { findTypeAvailabilityConflicts, hasRoomConflict } from "@/lib/availability"
import { allocateSequenceNumber } from "@/lib/document-sequence"
import { materializeReservationAllocations } from "@/lib/allocations-server"
import { logActivity } from "@/lib/activity-log"

// Thrown inside the pickup transaction when the block filled up between the pre-check and
// the create (a concurrent pickup took the last held room) — turned into a clean 400.
class BlockFullConflict extends Error {}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, "GROUP_BLOCKS", "update")

    const { id } = await params
    const body = await request.json()
    const {
      firstName,
      lastName,
      email,
      phone,
      roomTypeId,
      roomId,
      checkInDate,
      checkOutDate,
      adults,
      children,
      infants,
      ratePlanId: requestedRatePlanId,
      mealPlanCode,
      billToMaster
    } = body

    if (!firstName || !lastName || !roomTypeId || !checkInDate || !checkOutDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const group = await prisma.groupBlock.findUnique({
      where: { id },
      include: { property: true, masterFolios: true }
    })

    if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 })
    await assertPropertyAccess(ctx, group.propertyId)

    // Pickup dates must fall within the block window.
    const ci = new Date(checkInDate)
    const co = new Date(checkOutDate)
    if (co <= ci) {
      return NextResponse.json({ error: "Check-out must be after check-in." }, { status: 400 })
    }
    if (ci < group.startDate || co > group.endDate) {
      return NextResponse.json({ error: "Pickup dates must fall within the block's date range." }, { status: 400 })
    }

    // Block-level guards: a cancelled block can't be picked up; a past-cutoff block
    // has released its held rooms; and a block only holds totalRoomsHeld rooms —
    // pickups beyond that are a normal reservation, not a block pickup.
    if (group.status === "CANCELLED" || group.status === "LOST") {
      return NextResponse.json({ error: `This group block is ${group.status === "LOST" ? "marked lost" : "cancelled"} and cannot be picked up` }, { status: 400 })
    }
    if (group.cutoffDate && new Date() > group.cutoffDate) {
      return NextResponse.json(
        { error: "This group block's cutoff date has passed — its held rooms have been released. Book a regular reservation instead." },
        { status: 400 }
      )
    }
    if (group.totalRoomsHeld > 0) {
      const pickedUp = await prisma.reservation.count({
        where: { groupBlockId: id, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
      })
      if (pickedUp >= group.totalRoomsHeld) {
        return NextResponse.json(
          { error: `This block's ${group.totalRoomsHeld} held room${group.totalRoomsHeld > 1 ? "s are" : " is"} fully picked up.` },
          { status: 400 }
        )
      }
    }

    // Gate: the block's master folio (PM account) must exist before any pickup so
    // charges have somewhere to route. Checked after the block-state guards above so an
    // expired/cancelled/full block reports that first. Staff create it from the block page.
    const masterFolio = group.masterFolios.find((f) => f.isMaster && !f.isClosed)
    if (!masterFolio) {
      return NextResponse.json(
        { error: "Create the group's master folio before picking up rooms." },
        { status: 400 }
      )
    }
    // Default: bill the master folio; only false when staff explicitly opt the guest out.
    const groupBillToMaster = billToMaster !== false

    const roomType = await prisma.roomType.findUnique({ where: { id: roomTypeId } })
    if (!roomType || roomType.propertyId !== group.propertyId) {
      return NextResponse.json({ error: "Room type does not belong to this property" }, { status: 400 })
    }
    if (!roomType.isActive) {
      return NextResponse.json({ error: "This room type is inactive and cannot accept new reservations" }, { status: 400 })
    }
    if (roomId) {
      const room = await prisma.room.findUnique({ where: { id: roomId } })
      if (!room || room.propertyId !== group.propertyId || room.status === "OUT_OF_SERVICE") {
        return NextResponse.json({ error: "Room does not belong to this property or is out of service" }, { status: 400 })
      }
    }

    // Same overbooking guards as an ordinary reservation — a group pickup consumes
    // exactly the same physical inventory (see src/lib/availability.ts).
    const availabilityConflicts = await findTypeAvailabilityConflicts({
      propertyId: group.propertyId,
      segments: [{ roomTypeId, startDate: new Date(checkInDate), endDate: new Date(checkOutDate) }],
      // This pickup draws from THIS block's held rooms — don't let the block block itself.
      excludeGroupBlockId: id,
    })
    // Type-level overbooking is a soft, acknowledgeable warning; the physical same-room
    // guard below stays hard.
    if (availabilityConflicts.length > 0 && body.acknowledgeOverbook !== true) {
      return NextResponse.json({ error: availabilityConflicts.join("; "), requiresOverbookConfirm: true }, { status: 409 })
    }
    if (roomId) {
      const roomTaken = await hasRoomConflict({
        roomId,
        startDate: new Date(checkInDate),
        endDate: new Date(checkOutDate),
      })
      if (roomTaken) {
        return NextResponse.json({ error: "That room is already booked for the selected dates" }, { status: 409 })
      }
    }

    // The pickup dialog can name a specific rate plan; absent one, fall back to the
    // property's highest-priority plan (the pre-existing default).
    const ratePlan = requestedRatePlanId
      ? await prisma.ratePlan.findFirst({ where: { id: requestedRatePlanId, propertyId: group.propertyId } })
      : await prisma.ratePlan.findFirst({ where: { propertyId: group.propertyId }, orderBy: { priority: 'asc' } })

    if (!ratePlan) {
      return NextResponse.json(
        { error: requestedRatePlanId ? "Rate plan does not belong to this property" : "No rate plan configured for this property" },
        { status: 400 }
      )
    }

    // Sequential confirmation number — same REGISTRATION_NO sequence and prefix
    // format as an ordinary reservation (see reservations/route.ts), so group
    // pickups don't get an alien numbering scheme.
    const settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId: group.property.enterpriseId }
    })
    // Same fallback rule as reservations/route.ts: no configured prefix → the
    // property's globally-unique code, since bare per-property sequence numbers
    // would collide across properties on the global confirmationNo unique.
    const prefix = settings?.resConfirmPrefix || `${group.property.code}-`
    const length = settings?.resConfirmLength || 6
    let seq = await allocateSequenceNumber(group.propertyId, "REGISTRATION_NO")
    let confirmationNo = `${prefix}${String(seq).padStart(length, "0")}`
    for (let attempt = 0; attempt < 5; attempt++) {
      const taken = await prisma.reservation.findUnique({ where: { confirmationNo }, select: { id: true } })
      if (!taken) break
      seq = await allocateSequenceNumber(group.propertyId, "REGISTRATION_NO")
      confirmationNo = `${prefix}${String(seq).padStart(length, "0")}`
    }

    // Create the Profile and Reservation inside a transaction
    let result;
    try {
    result = await prisma.$transaction(async (tx) => {
      // Re-check the held-room count INSIDE the transaction so two concurrent pickups
      // can't both claim the last held room (the pre-check above is only a fast fail).
      if (group.totalRoomsHeld > 0) {
        const pickedUp = await tx.reservation.count({
          where: { groupBlockId: id, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
        })
        if (pickedUp >= group.totalRoomsHeld) throw new BlockFullConflict()
      }

      // 1. Create or Find Profile
      let profile = email
        ? await tx.profile.findFirst({
            where: { enterpriseId: group.property.enterpriseId, communications: { some: { type: "EMAIL", value: email } } }
          })
        : null

      if (!profile) {
        const commRows = [
          ...(email ? [{ type: "EMAIL", value: email, isPrimary: true }] : []),
          ...(phone ? [{ type: "MOBILE", value: phone, isPrimary: !email }] : []),
        ]
        profile = await tx.profile.create({
          data: {
            enterpriseId: group.property.enterpriseId,
            profileType: "GUEST",
            firstName,
            lastName,
            communications: commRows.length > 0 ? { create: commRows } : undefined
          }
        })
      }

      // 2. Create the Reservation
      const reservation = await tx.reservation.create({
        data: {
          propertyId: group.propertyId,
          confirmationNo,
          primaryGuestId: profile.upid,
          groupBlockId: id,
          groupBillToMaster,
          checkInDate: new Date(checkInDate),
          checkOutDate: new Date(checkOutDate),
          adults: parseInt(adults) || 1,
          children: parseInt(children) || 0,
          infants: parseInt(infants) || 0,
          mealPlan: mealPlanCode || "NONE",
          status: "RESERVED"
        }
      })

      // 3. Assign the Room
      await tx.roomAssignment.create({
        data: {
          reservationId: reservation.id,
          roomTypeId,
          roomId: roomId || null,
          ratePlanId: ratePlan.id,
          startDate: new Date(checkInDate),
          endDate: new Date(checkOutDate),
        }
      })

      // 4. Create the Folio for this reservation
      await tx.folio.create({
        data: {
          reservationId: reservation.id,
          propertyId: group.propertyId
        }
      })

      return reservation
    })
    } catch (txError) {
      if (txError instanceof BlockFullConflict) {
        return NextResponse.json(
          { error: `This block's ${group.totalRoomsHeld} held room${group.totalRoomsHeld > 1 ? "s are" : " is"} fully picked up.` },
          { status: 400 }
        )
      }
      throw txError
    }

    await logActivity({
      ctx,
      module: "GROUP_BLOCKS",
      action: "CREATE",
      entityType: "Reservation",
      entityId: result.id,
      description: `Group pickup ${confirmationNo} from block ${group.code} for ${firstName} ${lastName}`,
    })

    // Allocation parity with the ordinary reservation path: materialize the picked
    // rate plan's package allocations so Night Audit posts them (previously a group
    // pickup on a package rate silently lost its packages).
    const allocationResult = await materializeReservationAllocations({
      reservationId: result.id,
      propertyId: group.propertyId,
      ratePlanId: ratePlan.id,
      mealPlanCode: mealPlanCode || "NONE",
      manualAllocationIds: [],
    })
    if (allocationResult.error) {
      return NextResponse.json({ ...result, allocationWarning: allocationResult.error })
    }

    return NextResponse.json(result)
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
