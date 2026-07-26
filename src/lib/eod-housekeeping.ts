import type { Prisma } from "@prisma/client";
import { toUtcMidnight } from "@/lib/business-date";

export type EodHousekeepingMode = "OFF" | "STEP_DOWN" | "SET_STATUS";

// Statuses the auto-shift is allowed to move a room INTO / touch. Out-of-Order and
// Out-of-Service are deliberate admin holds — the shift never reads or writes them.
export const SHIFTABLE_STATUSES = ["CLEAN", "DIRTY", "INSPECTED"] as const;
const ADMIN_HELD = ["OUT_OF_ORDER", "OUT_OF_SERVICE"] as const;

export type EodHousekeepingResult = { occupiedToDirty: number; vacantShifted: number };

// Optional End-of-Day housekeeping auto-shift (app-owner request 2026-07-26). Called
// inside the Night Audit transaction as the business date rolls.
//
//   - OCCUPIED rooms (a live IN_HOUSE stay covering the audit date) ALWAYS become
//     DIRTY — a stayover needs servicing every day, no matter the mode.
//   - VACANT sellable rooms follow `mode`:
//       STEP_DOWN  — one status down: Inspected→Clean, Clean→Dirty, Dirty stays.
//       SET_STATUS — every vacant room set to `targetStatus`.
//   - Out-of-Order / Out-of-Service rooms are NEVER touched (deliberate holds).
//   - Only real housekeeping-board rooms participate (has a floor + roomType
//     housekeepingEnabled) — pseudo/day-use rooms are excluded, same as the board.
//
// A no-op when mode is OFF. Returns how many rooms moved, for logging.
export async function applyEodHousekeepingShift(
  tx: Prisma.TransactionClient,
  args: { propertyId: string; auditDate: Date; mode: string; targetStatus?: string | null }
): Promise<EodHousekeepingResult> {
  const { propertyId } = args;
  const mode = args.mode as EodHousekeepingMode;
  if (mode !== "STEP_DOWN" && mode !== "SET_STATUS") {
    return { occupiedToDirty: 0, vacantShifted: 0 };
  }
  const auditDate = toUtcMidnight(args.auditDate);

  // Rooms physically occupied on the audit date: a live IN_HOUSE stay whose assignment
  // spans it. (Overstays are still IN_HOUSE, so they correctly count as occupied.)
  const occupiedAssignments = await tx.roomAssignment.findMany({
    where: {
      roomId: { not: null },
      startDate: { lte: auditDate },
      endDate: { gte: auditDate },
      reservation: { propertyId, status: "IN_HOUSE" },
    },
    select: { roomId: true },
  });
  const occupiedRoomIds = [...new Set(occupiedAssignments.map((a) => a.roomId).filter((id): id is string => !!id))];

  // Housekeeping-board scope, admin holds excluded — the shift only ever touches these.
  const boardScope = {
    propertyId,
    floorId: { not: null },
    roomType: { is: { housekeepingEnabled: true } },
    status: { notIn: [...ADMIN_HELD] },
  } satisfies Prisma.RoomWhereInput;

  // Occupied → DIRTY (daily service), regardless of mode.
  let occupiedToDirty = 0;
  if (occupiedRoomIds.length > 0) {
    const r = await tx.room.updateMany({
      where: { ...boardScope, id: { in: occupiedRoomIds } },
      data: { status: "DIRTY" },
    });
    occupiedToDirty = r.count;
  }

  // Vacant = board rooms not in the occupied set. `notIn: []` correctly matches all
  // when nothing is occupied.
  const vacantScope: Prisma.RoomWhereInput = { ...boardScope, id: { notIn: occupiedRoomIds } };

  let vacantShifted = 0;
  if (mode === "SET_STATUS") {
    const target = args.targetStatus ?? "";
    if (!(SHIFTABLE_STATUSES as readonly string[]).includes(target)) {
      // Misconfigured target — leave vacant rooms alone rather than write a bad status.
      return { occupiedToDirty, vacantShifted: 0 };
    }
    const r = await tx.room.updateMany({ where: vacantScope, data: { status: target } });
    vacantShifted = r.count;
  } else {
    // STEP_DOWN — order matters: demote Clean→Dirty FIRST, then Inspected→Clean, so a
    // room that starts Inspected lands on Clean (one step), not Dirty (two).
    const cleanToDirty = await tx.room.updateMany({
      where: { ...vacantScope, status: "CLEAN" },
      data: { status: "DIRTY" },
    });
    const inspectedToClean = await tx.room.updateMany({
      where: { ...vacantScope, status: "INSPECTED" },
      data: { status: "CLEAN" },
    });
    vacantShifted = cleanToDirty.count + inspectedToClean.count;
  }

  return { occupiedToDirty, vacantShifted };
}
