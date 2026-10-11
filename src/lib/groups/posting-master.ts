import { prisma } from "@/lib/db"
import type { Prisma } from "@prisma/client"
import { allocateSequenceNumber } from "@/lib/document-sequence"
import { getPropertySettings } from "@/lib/property-settings"

// The block's Posting Master (PM) reservation (owner request, 2026-10-11).
//
// A group block gets one reservation of its own, in a pseudo "PM" room, created when the
// block goes Definite (or when staff create the master folio by hand). Its folio IS the
// block's master folio — the folio every pickup's charges route to (Night Audit, held
// nights, transport billing all find it as `Folio { groupBlockId, isMaster }`). It is a
// reservation like any other (arrives, is checked in, is checked out and settled), but:
//   · it is NOT a pickup — it carries no groupBlockId, so it never counts against the rooms
//     held, and the block's own link is GroupBlock.postingMasterReservationId;
//   · it sits in a pseudo room type, which availability, occupancy and licence caps ignore;
//   · Night Audit posts nothing for it (isPostingMaster) — it exists to receive charges;
//   · it is checked in automatically when the first pickup of the block checks in.

const PM_TYPE_CODE = "PM"

type Db = Prisma.TransactionClient | typeof prisma

/** The property's pseudo PM room type — created the first time a block needs one. */
async function pmRoomType(propertyId: string) {
  const existing = await prisma.roomType.findFirst({ where: { propertyId, isPseudo: true, code: PM_TYPE_CODE } })
  if (existing) return existing
  return prisma.roomType.create({
    data: {
      propertyId,
      code: PM_TYPE_CODE,
      name: "Posting Master",
      description: "Pseudo room type for group Posting Master reservations. Not sellable, not counted in occupancy.",
      isPseudo: true,
      housekeepingEnabled: false,
      baseOccupancy: 1,
      maxOccupancy: 1,
    },
  })
}

async function nextConfirmationNo(propertyId: string, propertyCode: string) {
  const settings = await getPropertySettings(propertyId)
  const prefix = settings.resConfirmPrefix || `${propertyCode}-`
  const length = settings.resConfirmLength || 6
  let confirmationNo = ""
  for (let attempt = 0; attempt < 6; attempt++) {
    const seq = await allocateSequenceNumber(propertyId, "REGISTRATION_NO")
    confirmationNo = `${prefix}${String(seq).padStart(length, "0")}`
    const taken = await prisma.reservation.findUnique({ where: { confirmationNo }, select: { id: true } })
    if (!taken) break
  }
  return confirmationNo
}

/**
 * Makes sure the block has its Posting Master reservation (and so its master folio).
 * Idempotent. Returns the reservation and the master folio, and whether anything was created.
 * An older block that already has a bare master folio keeps it: the folio is attached to the
 * new PM reservation, with its charges intact.
 */
export async function ensurePostingMaster(groupBlockId: string) {
  const group = await prisma.groupBlock.findUnique({
    where: { id: groupBlockId },
    include: { property: { select: { enterpriseId: true, code: true } }, masterFolios: true },
  })
  if (!group) throw new Error("Group block not found")

  if (group.postingMasterReservationId) {
    const reservation = await prisma.reservation.findUnique({ where: { id: group.postingMasterReservationId } })
    const folio = group.masterFolios.find((f) => f.isMaster && !f.isClosed) ?? group.masterFolios.find((f) => f.isMaster) ?? null
    if (reservation) return { created: false, reservation, folio }
  }

  const roomType = await pmRoomType(group.propertyId)
  const ratePlan =
    (await prisma.ratePlan.findFirst({ where: { propertyId: group.propertyId, isLocked: true } })) ??
    (await prisma.ratePlan.findFirst({ where: { propertyId: group.propertyId }, orderBy: { priority: "asc" } }))
  if (!ratePlan) throw new Error("No rate plan configured for this property")

  // One PM room per block, so blocks that overlap never fight over a room.
  const roomNumber = `PM-${group.code}`
  const room =
    (await prisma.room.findFirst({ where: { propertyId: group.propertyId, roomTypeId: roomType.id, roomNumber } })) ??
    (await prisma.room.create({ data: { propertyId: group.propertyId, roomTypeId: roomType.id, roomNumber } }))

  // The guest: the block's payee account when it has one, else a company profile named after the block.
  const guestId =
    group.payeeProfileId ??
    (
      await prisma.profile.create({
        data: {
          enterpriseId: group.property.enterpriseId,
          profileType: "COMPANY",
          firstName: group.name,
          companyName: group.name,
          originPropertyId: group.propertyId,
        },
      })
    ).upid

  const confirmationNo = await nextConfirmationNo(group.propertyId, group.property.code)
  const legacyMaster = group.masterFolios.find((f) => f.isMaster && !f.isClosed && !f.reservationId) ?? null

  const result = await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.create({
      data: {
        propertyId: group.propertyId,
        confirmationNo,
        primaryGuestId: guestId,
        isPostingMaster: true,
        checkInDate: group.startDate,
        checkOutDate: group.endDate,
        adults: 1,
        children: 0,
        infants: 0,
        mealPlan: "NONE",
        status: "RESERVED",
        remarks: `Posting Master for group block ${group.code}`,
      },
    })
    await tx.roomAssignment.create({
      data: {
        reservationId: reservation.id,
        roomTypeId: roomType.id,
        roomId: room.id,
        ratePlanId: ratePlan.id,
        overrideRate: 0, // never charged: it exists to receive the group's charges
        startDate: group.startDate,
        endDate: group.endDate,
      },
    })
    const settlement = group.payeeProfileId ? { settlementMethod: "CITY_LEDGER", payeeProfileId: group.payeeProfileId } : {}
    const folio = legacyMaster
      ? await tx.folio.update({ where: { id: legacyMaster.id }, data: { reservationId: reservation.id, folioNumber: 1 } })
      : await tx.folio.create({
          data: {
            reservationId: reservation.id,
            propertyId: group.propertyId,
            groupBlockId: group.id,
            isMaster: true,
            folioNumber: 1,
            // Block linked to a credit account: the master bill is a City-Ledger receivable for it.
            ...settlement,
          },
        })
    await tx.groupBlock.update({ where: { id: group.id }, data: { postingMasterReservationId: reservation.id } })
    return { reservation, folio }
  })
  return { created: true, ...result }
}

/**
 * A pickup of the block has checked in: check the Posting Master in too, so the charges
 * routed to it land on an in-house master. No-op when the block has none, or it has
 * already arrived. Pass the transaction the pickup's check-in runs in.
 */
export async function checkInPostingMaster(db: Db, groupBlockId: string) {
  const group = await db.groupBlock.findUnique({ where: { id: groupBlockId }, select: { postingMasterReservationId: true } })
  if (!group?.postingMasterReservationId) return null
  const pm = await db.reservation.findUnique({ where: { id: group.postingMasterReservationId }, select: { id: true, status: true, confirmationNo: true } })
  if (!pm || pm.status !== "RESERVED") return null
  await db.reservation.update({ where: { id: pm.id }, data: { status: "IN_HOUSE", checkedInAt: new Date() } })
  return pm
}

/** The block's dates changed: keep the Posting Master's stay in step (arrival only until it has arrived). */
export async function syncPostingMasterDates(groupBlockId: string) {
  const group = await prisma.groupBlock.findUnique({ where: { id: groupBlockId }, select: { postingMasterReservationId: true, startDate: true, endDate: true } })
  if (!group?.postingMasterReservationId) return
  const pm = await prisma.reservation.findUnique({ where: { id: group.postingMasterReservationId }, select: { id: true, status: true } })
  if (!pm || !["RESERVED", "IN_HOUSE"].includes(pm.status)) return
  await prisma.$transaction([
    prisma.reservation.update({
      where: { id: pm.id },
      data: { checkOutDate: group.endDate, ...(pm.status === "RESERVED" ? { checkInDate: group.startDate } : {}) },
    }),
    prisma.roomAssignment.updateMany({
      where: { reservationId: pm.id },
      data: { endDate: group.endDate, ...(pm.status === "RESERVED" ? { startDate: group.startDate } : {}) },
    }),
  ])
}

/**
 * The block is cancelled or lost: cancel its Posting Master, unless it has charges or
 * payments on its folio, or has already arrived. Returns an error message when it can't be.
 */
export async function cancelPostingMaster(groupBlockId: string): Promise<string | null> {
  const group = await prisma.groupBlock.findUnique({ where: { id: groupBlockId }, select: { postingMasterReservationId: true } })
  if (!group?.postingMasterReservationId) return null
  const pm = await prisma.reservation.findUnique({
    where: { id: group.postingMasterReservationId },
    select: { id: true, status: true, folios: { select: { lineItems: { select: { id: true }, take: 1 }, payments: { select: { id: true }, take: 1 } } } },
  })
  if (!pm || pm.status === "CANCELLED") return null
  if (pm.status !== "RESERVED") return "The block's Posting Master has already arrived. Check it out first."
  if (pm.folios.some((f) => f.lineItems.length > 0 || f.payments.length > 0)) {
    return "The block's master folio has charges or payments. Settle or move them first."
  }
  await prisma.reservation.update({ where: { id: pm.id }, data: { status: "CANCELLED" } })
  return null
}
