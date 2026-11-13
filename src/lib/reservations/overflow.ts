import { prisma } from "@/lib/db";
import { requireCapability, type AuthContext } from "@/lib/scope";
import { findTypeAvailabilityConflicts } from "@/lib/availability";
import { toUtcMidnight } from "@/lib/business-date";
import { getPropertySettings } from "@/lib/property-settings";
import { logActivity } from "@/lib/activity-log";

// Overflow bookings (Agent Portal plan A-8, Phase 2, 9.2.0).
//
// "Book under PM" in the owner's brief means: the house is full, so the guest is put up at
// a partner hotel. That is its OWN pseudo room type, OVF — never the Posting Master type,
// whose reservations Night Audit deliberately posts nothing for. An overflow booking:
//   · sits in OVF (pseudo: no availability, occupancy or licence counting),
//   · is charged normally (revenue counts),
//   · gets no Green Tax and no registration number here (owner, 2026-11-11),
//   · is marked on every list and the Tape Chart, and has its own report,
//   · is always a person's decision ("Mark or clear Overflow" capability),
//   · can be moved into a real room type later when a room frees up.

export const OVF_TYPE_CODE = "OVF";

export class OverflowError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/** The property's pseudo Overflow room type, created the first time it is needed. */
export async function overflowRoomType(propertyId: string) {
  const existing = await prisma.roomType.findFirst({ where: { propertyId, isPseudo: true, code: OVF_TYPE_CODE } });
  if (existing) return existing;
  return prisma.roomType.create({
    data: {
      propertyId,
      code: OVF_TYPE_CODE,
      name: "Overflow",
      description: "Pseudo room type for guests accommodated at a partner hotel when the house is full. Not counted in availability or occupancy.",
      isPseudo: true,
      housekeepingEnabled: false,
      baseOccupancy: 1,
      maxOccupancy: 10,
    },
  });
}

/** Overflow bookings per night in a window (for the per-night cap and the Overflow row). */
export async function overflowCountsByNight(propertyId: string, from: Date, to: Date, excludeReservationId?: string) {
  const rows = await prisma.reservation.findMany({
    where: {
      propertyId,
      isOverflow: true,
      status: { in: ["TENTATIVE", "RESERVED", "IN_HOUSE"] },
      checkInDate: { lt: to },
      checkOutDate: { gt: from },
      ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}),
    },
    select: { checkInDate: true, checkOutDate: true },
  });
  // Keyed by UTC-midnight day (how stay dates are stored), the same keys the grid uses.
  const day = (d: Date) => toUtcMidnight(d).getTime();
  const counts = new Map<number, number>();
  for (let n = day(from); n < day(to); n += 86_400_000) {
    counts.set(n, rows.filter((r) => day(r.checkInDate) <= n && day(r.checkOutDate) > n).length);
  }
  return counts;
}

/** OVERFLOW_FULL when the property caps overflow per night and this stay would pass it. */
export async function assertOverflowRoom(propertyId: string, checkIn: Date, checkOut: Date, excludeReservationId?: string) {
  const { maxOverflowPerNight } = await getPropertySettings(propertyId);
  if (maxOverflowPerNight === null || maxOverflowPerNight === undefined) return;
  const counts = await overflowCountsByNight(propertyId, checkIn, checkOut, excludeReservationId);
  const full = [...counts.entries()].find(([, c]) => c + 1 > maxOverflowPerNight);
  if (full) {
    throw new OverflowError(
      409,
      `Overflow is full on ${new Date(full[0]).toLocaleDateString("en-CA")}: at most ${maxOverflowPerNight} a night.`,
      "OVERFLOW_FULL"
    );
  }
}

async function load(ctx: AuthContext, id: string) {
  const r = await prisma.reservation.findUnique({
    where: { id },
    include: { assignments: true, property: { select: { enterpriseId: true } } },
  });
  if (!r || r.property.enterpriseId !== ctx.enterpriseId) throw new OverflowError(404, "Reservation not found");
  if (ctx.scope === "PROPERTY" && ctx.propertyId !== r.propertyId) throw new OverflowError(404, "Reservation not found");
  if (!["TENTATIVE", "RESERVED"].includes(r.status)) {
    throw new OverflowError(409, "Only a booking that has not arrived can be moved in or out of Overflow.", "BOOKING_LOCKED");
  }
  return r;
}

/** Put a booking at the partner hotel: every segment moves to OVF, the room is unassigned. */
export async function markOverflow(ctx: AuthContext, id: string, input: { hotelName?: string | null; note?: string | null }) {
  requireCapability(ctx, "reservations.markOverflow");
  const r = await load(ctx, id);
  const hotelName = input.hotelName?.trim() || null;
  if (!hotelName) throw new OverflowError(400, "Name the partner hotel.");
  await assertOverflowRoom(r.propertyId, r.checkInDate, r.checkOutDate, r.id);
  const ovf = await overflowRoomType(r.propertyId);
  await prisma.$transaction(async (tx) => {
    await tx.roomAssignment.updateMany({ where: { reservationId: id }, data: { roomTypeId: ovf.id, roomId: null } });
    await tx.reservation.update({
      where: { id },
      data: { isOverflow: true, overflowHotelName: hotelName, overflowNote: input.note?.trim() || null },
    });
  });
  await logActivity({
    ctx,
    module: "RESERVATIONS",
    action: "UPDATE",
    entityType: "Reservation",
    entityId: id,
    description: `Reservation ${r.confirmationNo}: moved to Overflow (${hotelName})`,
  });
  return prisma.reservation.findUnique({ where: { id } });
}

/** "Move to room type": a room has freed up, so the overflow booking comes into the house. */
export async function clearOverflow(ctx: AuthContext, id: string, input: { roomTypeId: string; acknowledgeOverbook?: boolean }) {
  requireCapability(ctx, "reservations.markOverflow");
  const r = await load(ctx, id);
  if (!r.isOverflow) throw new OverflowError(409, "This booking is not in Overflow.");
  const rt = await prisma.roomType.findFirst({ where: { id: input.roomTypeId, propertyId: r.propertyId, isPseudo: false } });
  if (!rt) throw new OverflowError(400, "Pick a real room type.");
  const conflicts = await findTypeAvailabilityConflicts({
    propertyId: r.propertyId,
    segments: [{ roomTypeId: rt.id, startDate: r.checkInDate, endDate: r.checkOutDate }],
    excludeReservationId: id,
  });
  if (conflicts.length > 0 && !input.acknowledgeOverbook) {
    throw new OverflowError(409, `No room free: ${conflicts.join("; ")}`, "NO_AVAILABILITY");
  }
  await prisma.$transaction(async (tx) => {
    await tx.roomAssignment.updateMany({ where: { reservationId: id }, data: { roomTypeId: rt.id, roomId: null } });
    await tx.reservation.update({ where: { id }, data: { isOverflow: false, overflowHotelName: null, overflowNote: null } });
  });
  await logActivity({
    ctx,
    module: "RESERVATIONS",
    action: "UPDATE",
    entityType: "Reservation",
    entityId: id,
    description: `Reservation ${r.confirmationNo}: moved from Overflow into ${rt.name}`,
  });
  return prisma.reservation.findUnique({ where: { id } });
}
