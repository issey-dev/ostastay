import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/scope";

// Server-side guards for Hub › property › Rooms & Inventory (room types, buildings,
// floors, rooms). Kept in one place so the four delete routes apply the SAME rule and the
// same wording.
//
// Delete rule (2026-09-24): a room type / building / floor / room is only deleted when
// nothing that is history points at it (or at any room under it). "History" is:
//   - a reservation's room assignment (RoomAssignment.roomTypeId / chargeRoomTypeId /
//     roomId — any status, cancelled included: it is still a booking record),
//   - a group block's room-type hold (GroupBlockRoom),
//   - a channel (OTA) inbound booking (ChannelInboundBooking.roomTypeId),
//   - a maintenance ticket on a room (RoomMaintenance).
// Housekeeping tasks are deliberately NOT history here: they are day-to-day work items that
// the database already cascades away with the room.
// When history exists the delete is refused with a 409 telling the user to make the room
// type inactive (or take the room out of service) instead. Otherwise everything goes in
// ONE transaction, so a failure part-way can never leave a room type with its rooms gone.

export class InventoryConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "InventoryConflictError";
  }
}

type Tx = Prisma.TransactionClient;

export type RoomHistory = {
  reservations: number;
  groupBlocks: number;
  channelBookings: number;
  maintenance: number;
  /** Room numbers (of the rooms in scope) that carry any of the above. */
  roomNumbers: string[];
};

export function hasHistory(h: RoomHistory): boolean {
  return h.reservations + h.groupBlocks + h.channelBookings + h.maintenance > 0;
}

/**
 * Counts the history attached to a set of room types and/or rooms. Rooms of the given
 * room types are included automatically.
 */
export async function findInventoryHistory(
  db: Tx | typeof prisma,
  { roomTypeIds = [], roomIds = [] }: { roomTypeIds?: string[]; roomIds?: string[] }
): Promise<RoomHistory> {
  const rooms = await db.room.findMany({
    where: { OR: [{ id: { in: roomIds } }, { roomTypeId: { in: roomTypeIds } }] },
    select: { id: true, roomNumber: true },
  });
  const allRoomIds = rooms.map((r) => r.id);

  const [reservations, groupBlocks, channelBookings, maintenance, roomsWithAssignments, roomsWithTickets] =
    await Promise.all([
      db.roomAssignment.count({
        where: {
          OR: [
            { roomId: { in: allRoomIds } },
            { roomTypeId: { in: roomTypeIds } },
            { chargeRoomTypeId: { in: roomTypeIds } },
          ],
        },
      }),
      roomTypeIds.length ? db.groupBlockRoom.count({ where: { roomTypeId: { in: roomTypeIds } } }) : 0,
      roomTypeIds.length ? db.channelInboundBooking.count({ where: { roomTypeId: { in: roomTypeIds } } }) : 0,
      db.roomMaintenance.count({ where: { roomId: { in: allRoomIds } } }),
      db.roomAssignment.findMany({ where: { roomId: { in: allRoomIds } }, select: { roomId: true }, distinct: ["roomId"] }),
      db.roomMaintenance.findMany({ where: { roomId: { in: allRoomIds } }, select: { roomId: true }, distinct: ["roomId"] }),
    ]);

  const flagged = new Set<string>([
    ...roomsWithAssignments.map((a) => a.roomId!).filter(Boolean),
    ...roomsWithTickets.map((t) => t.roomId),
  ]);
  const roomNumbers = rooms
    .filter((r) => flagged.has(r.id))
    .map((r) => r.roomNumber)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return { reservations, groupBlocks, channelBookings, maintenance, roomNumbers };
}

/** "reservations and a group block" — what the history consists of, for a message. */
export function describeHistory(h: RoomHistory): string {
  const parts: string[] = [];
  if (h.reservations) parts.push("reservations");
  if (h.groupBlocks) parts.push("group blocks");
  if (h.channelBookings) parts.push("channel bookings");
  if (h.maintenance) parts.push("maintenance tickets");
  if (parts.length <= 1) return parts[0] ?? "history";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function roomList(numbers: string[], max = 5): string {
  if (numbers.length <= max) return numbers.join(", ");
  return `${numbers.slice(0, max).join(", ")} and ${numbers.length - max} more`;
}

/** P2002 — a unique constraint was hit (a racing duplicate the pre-check didn't see). */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Throws a 409 when another room type in the property already uses this code. Codes are
 * compared case-insensitively (DLX and dlx would be indistinguishable on a report); the
 * database index backs up the exact-match case.
 */
export async function assertRoomTypeCodeFree(propertyId: string, code: string, exceptId?: string) {
  const clash = await prisma.roomType.findFirst({
    where: {
      propertyId,
      code: { equals: code, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { name: true, code: true },
  });
  if (clash) {
    throw new InventoryConflictError(
      `Room type code "${clash.code}" is already used by "${clash.name}". Codes must be unique within the property.`
    );
  }
}

/** Throws a 409 when the property already has a room with this number. */
export async function assertRoomNumberFree(propertyId: string, roomNumber: string, exceptId?: string) {
  const clash = await prisma.room.findFirst({
    where: {
      propertyId,
      roomNumber: { equals: roomNumber, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { roomNumber: true },
  });
  if (clash) {
    throw new InventoryConflictError(`Room ${clash.roomNumber} already exists in this property.`);
  }
}

/**
 * License cap for rooms when SEVERAL rooms start counting at once — e.g. a pseudo room
 * type with rooms is switched to a real one. assertRoomCapacity() in src/lib/license.ts
 * covers the one-new-room case; this is the same rule for `adding` rooms.
 */
export async function assertRoomHeadroom(propertyId: string, adding: number) {
  if (adding <= 0) return;
  const allowance = await prisma.propertyLicenseAllowance.findUnique({ where: { propertyId } });
  if (allowance?.maxRooms == null) return;
  const used = await prisma.room.count({ where: { roomType: { propertyId, isPseudo: false } } });
  if (used + adding > allowance.maxRooms) {
    throw new ForbiddenError(
      `This property's license allows up to ${allowance.maxRooms} room${allowance.maxRooms === 1 ? "" : "s"} (PM rooms excluded) — this change would bring it to ${used + adding}. Contact Osta to increase this limit.`
    );
  }
}

/** Error → response body/status for the inventory routes (409s first, then the shared mapping). */
export function inventoryErrorResponse(
  e: unknown,
  fallback: (e: unknown) => { status: number; body: { error: string; code?: string } },
  uniqueMessage = "That already exists in this property."
): { status: number; body: { error: string; code?: string } } {
  if (e instanceof InventoryConflictError) return { status: 409, body: { error: e.message } };
  if (isUniqueViolation(e)) return { status: 409, body: { error: uniqueMessage } };
  return fallback(e);
}
