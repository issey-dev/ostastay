import type { Prisma } from "@prisma/client"
import type { prisma } from "@/lib/db"
import { detectScheduledRoomMove } from "@/lib/reservation-assignments"

type Db = Prisma.TransactionClient | typeof prisma

/**
 * Re-derives Reservation.hasScheduledRoomMove from the stay's segments after a room change made
 * outside the booking form (a Tape Chart drag, a Front Desk room move) - the form and the create
 * route set it themselves, so without this the "Room move" badge would go stale.
 */
export async function refreshScheduledRoomMove(db: Db, reservationId: string) {
  const segments = await db.roomAssignment.findMany({ where: { reservationId }, select: { startDate: true, endDate: true, roomId: true } })
  await db.reservation.update({ where: { id: reservationId }, data: { hasScheduledRoomMove: detectScheduledRoomMove(segments) } })
}
