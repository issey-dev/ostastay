import { prisma } from "@/lib/db";
import { INVENTORY_HOLDING_STATUSES, UNSELLABLE_ROOM_STATUSES } from "@/lib/availability";

// Auto-assign works in two steps so staff always see what is about to happen: a PLAN
// (nothing is written) and then APPLY of the confirmed plan, which re-checks every room
// against what is in the database at that moment.

export type AutoAssignProposal = {
  assignmentId: string;
  reservationId: string;
  confirmationNo: string;
  guestName: string;
  startDate: string;
  endDate: string;
  roomTypeCode: string;
  roomId: string;
  roomNumber: string;
};

export type AutoAssignUnassigned = {
  assignmentId: string;
  reservationId: string;
  confirmationNo: string;
  guestName: string;
  startDate: string;
  endDate: string;
  roomTypeCode: string;
  reason: string;
};

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && aEnd > bStart;

export async function planAutoAssign(propertyId: string): Promise<{ proposals: AutoAssignProposal[]; unassigned: AutoAssignUnassigned[] }> {
  const reservations = await prisma.reservation.findMany({
    where: {
      propertyId,
      // Only bookings that still hold inventory need a room.
      status: { in: INVENTORY_HOLDING_STATUSES },
      assignments: { some: { roomId: null } },
    },
    select: {
      id: true,
      confirmationNo: true,
      primaryGuest: { select: { firstName: true, lastName: true, companyName: true, profileType: true } },
      assignments: {
        where: { roomId: null },
        select: { id: true, roomTypeId: true, startDate: true, endDate: true, roomType: { select: { code: true } } },
      },
    },
    orderBy: { checkInDate: "asc" },
  });
  if (reservations.length === 0) return { proposals: [], unassigned: [] };

  const allAssignments = reservations.flatMap((r) => r.assignments);
  const from = new Date(Math.min(...allAssignments.map((a) => a.startDate.getTime())));
  const to = new Date(Math.max(...allAssignments.map((a) => a.endDate.getTime())));

  const [rooms, taken] = await Promise.all([
    prisma.room.findMany({
      where: { propertyId, status: { notIn: UNSELLABLE_ROOM_STATUSES } },
      select: { id: true, roomNumber: true, roomTypeId: true },
      orderBy: { roomNumber: "asc" },
    }),
    prisma.roomAssignment.findMany({
      where: {
        roomId: { not: null },
        room: { propertyId },
        reservation: { status: { in: INVENTORY_HOLDING_STATUSES } },
        startDate: { lt: to },
        endDate: { gt: from },
      },
      select: { roomId: true, startDate: true, endDate: true },
    }),
  ]);

  // Stays already holding each room, grown as the plan hands rooms out.
  const busy = new Map<string, { start: Date; end: Date }[]>();
  for (const t of taken) {
    const list = busy.get(t.roomId!) ?? [];
    list.push({ start: t.startDate, end: t.endDate });
    busy.set(t.roomId!, list);
  }
  const roomsOfType = new Map<string, typeof rooms>();
  for (const r of rooms) roomsOfType.set(r.roomTypeId, [...(roomsOfType.get(r.roomTypeId) ?? []), r]);

  const proposals: AutoAssignProposal[] = [];
  const unassigned: AutoAssignUnassigned[] = [];

  for (const res of reservations) {
    const g = res.primaryGuest;
    const guestName =
      g.profileType === "COMPANY" || g.profileType === "TRAVEL_AGENT" ? g.companyName || "" : [g.firstName, g.lastName].filter(Boolean).join(" ");
    for (const a of res.assignments) {
      const candidates = roomsOfType.get(a.roomTypeId) ?? [];
      const room = candidates.find((c) => !(busy.get(c.id) ?? []).some((b) => overlaps(b.start, b.end, a.startDate, a.endDate)));
      const base = {
        assignmentId: a.id,
        reservationId: res.id,
        confirmationNo: res.confirmationNo,
        guestName,
        startDate: a.startDate.toISOString(),
        endDate: a.endDate.toISOString(),
        roomTypeCode: a.roomType.code,
      };
      if (room) {
        busy.set(room.id, [...(busy.get(room.id) ?? []), { start: a.startDate, end: a.endDate }]);
        proposals.push({ ...base, roomId: room.id, roomNumber: room.roomNumber });
      } else {
        unassigned.push({
          ...base,
          reason: candidates.length === 0 ? `No ${a.roomType.code} rooms are in service` : `Every ${a.roomType.code} room is taken for these dates`,
        });
      }
    }
  }
  return { proposals, unassigned };
}

/** Writes a confirmed plan. Each room is re-checked at write time (someone may have booked
 *  it since the preview); anything that no longer fits is skipped and reported. */
export async function applyAutoAssign(propertyId: string, picks: { assignmentId: string; roomId: string }[]) {
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const pick of picks) {
    const ok = await prisma.$transaction(async (tx) => {
      const a = await tx.roomAssignment.findFirst({
        where: { id: pick.assignmentId, roomId: null, reservation: { propertyId, status: { in: INVENTORY_HOLDING_STATUSES } } },
        select: { id: true, roomTypeId: true, startDate: true, endDate: true },
      });
      if (!a) return false;
      const room = await tx.room.findFirst({
        where: { id: pick.roomId, propertyId, roomTypeId: a.roomTypeId, status: { notIn: UNSELLABLE_ROOM_STATUSES } },
        select: { id: true },
      });
      if (!room) return false;
      const clash = await tx.roomAssignment.findFirst({
        where: {
          roomId: room.id,
          id: { not: a.id },
          reservation: { status: { in: INVENTORY_HOLDING_STATUSES } },
          startDate: { lt: a.endDate },
          endDate: { gt: a.startDate },
        },
        select: { id: true },
      });
      if (clash) return false;
      await tx.roomAssignment.update({ where: { id: a.id }, data: { roomId: room.id } });
      return true;
    });
    (ok ? applied : skipped).push(pick.assignmentId);
  }
  return { applied, skipped };
}
