import { prisma } from "@/lib/db";
import { getPropertySettings } from "@/lib/property-settings";
import { findTypeAvailabilityConflicts, hasRoomConflict } from "@/lib/availability";
import { findStopSaleConflicts } from "@/lib/restrictions";
import { allocateSequenceNumber } from "@/lib/document-sequence";
import { materializeReservationAllocations } from "@/lib/allocations-server";
import { logActivity } from "@/lib/activity-log";
import { hasCapability, type AuthContext } from "@/lib/scope";
import { sellLimitGate } from "@/lib/availability-sell-limit";
import { lockKeys, BOOKING_TX_OPTIONS } from "@/lib/db-lock";
import { computeOptionDate } from "@/lib/reservations/options";
import { toUtcMidnight } from "@/lib/business-date";

// A pickup into a group block: one booking inside a block's held rooms. Shared by the desk
// (POST /api/groups/[id]/pickup) and the Agent API, so every rule holds on both doors.
// Extracted from the route in Agent Portal plan Phase 4 (9.4.0), which added:
//   · TENTATIVE pickups (option date = the block's cutoff, else the property default, else
//     a short option for a booking after the cutoff),
//   · pickups on a TENTATIVE block (no master folio yet: the guest keeps their own folio),
//   · elasticity: up to elasticNightsBefore/After outside the block dates and elasticRooms
//     above the hold on any night, always subject to the house having the room,
//   · the per-night hold count (a long slot is judged night by night, not as one total),
//   · the Source of the block on every pickup, and the last-room advisory lock.

export type PickupInput = {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  primaryGuestId?: string | null;
  roomTypeId: string;
  roomId?: string | null;
  checkInDate: string | Date;
  checkOutDate: string | Date;
  adults?: number | string;
  children?: number | string;
  infants?: number | string;
  ratePlanId?: string | null;
  mealPlanCode?: string | null;
  billToMaster?: boolean;
  acknowledgeOverbook?: boolean;
  status?: "TENTATIVE" | "RESERVED";
  remarks?: string | null;
  /** Agent API: the door it came through and the portal login. Agents never overbook. */
  origin?: "GROUP_PICKUP" | "AGENT_PORTAL";
  agentUserId?: string | null;
  packageName?: string | null;
  agentReference?: string | null;
};

export type PickupResult =
  | { ok: true; reservation: { id: string; confirmationNo: string; status: string }; allocationWarning?: string; elastic?: boolean }
  | { ok: false; status: number; error: string; code?: string; requiresOverbookConfirm?: boolean };

const DAY = 86_400_000;
const fail = (status: number, error: string, code?: string, requiresOverbookConfirm?: boolean): PickupResult => ({
  ok: false,
  status,
  error,
  ...(code ? { code } : {}),
  ...(requiresOverbookConfirm ? { requiresOverbookConfirm } : {}),
});

class Raced extends Error {
  constructor(public result: PickupResult) {
    super("raced");
  }
}

export async function pickupIntoBlock(ctx: AuthContext, blockId: string, input: PickupInput): Promise<PickupResult> {
  const isAgent = input.origin === "AGENT_PORTAL";
  const acknowledgeOverbook = !isAgent && input.acknowledgeOverbook === true;
  if (acknowledgeOverbook && !hasCapability(ctx, "reservations.overbook")) return fail(403, "Your role does not allow overbooking.");

  if (!input.firstName || !input.lastName || !input.roomTypeId || !input.checkInDate || !input.checkOutDate) {
    return fail(400, "Missing required fields");
  }
  const group = await prisma.groupBlock.findUnique({
    where: { id: blockId },
    include: { property: true, masterFolios: true, roomHolds: true },
  });
  if (!group || group.property.enterpriseId !== ctx.enterpriseId) return fail(404, "Group not found");

  const ci = toUtcMidnight(new Date(input.checkInDate));
  const co = toUtcMidnight(new Date(input.checkOutDate));
  if (co <= ci) return fail(400, "Check-out must be after check-in.");

  if (group.status === "REQUESTED") return fail(409, "This slot has not been approved yet.", "SLOT_NOT_APPROVED");
  if (["CANCELLED", "LOST", "DECLINED"].includes(group.status)) {
    return fail(400, `This group block is ${group.status === "LOST" ? "marked lost" : group.status.toLowerCase()} and cannot be picked up`);
  }

  // Dates: inside the block, or inside its elastic nights before/after.
  const earliest = new Date(group.startDate.getTime() - group.elasticNightsBefore * DAY);
  const latest = new Date(group.endDate.getTime() + group.elasticNightsAfter * DAY);
  if (ci < earliest || co > latest) {
    return fail(
      400,
      group.elasticNightsBefore || group.elasticNightsAfter
        ? "Those dates go past the slot and its flexible nights. Request another slot."
        : "Pickup dates must fall within the block's date range.",
      "SLOT_FULL"
    );
  }

  const now = new Date();
  const pastCutoff = !!group.cutoffDate && now > group.cutoffDate;
  const hasElasticity = group.elasticRooms > 0 || group.elasticNightsBefore > 0 || group.elasticNightsAfter > 0;
  if (pastCutoff && !hasElasticity) {
    return fail(400, "This group block's cutoff date has passed and its held rooms have been released. Book a regular reservation instead.", "SLOT_FULL");
  }

  // Per night inside the block: live pickups + this one must stay within hold + elasticRooms.
  const nightsInBlock: number[] = [];
  for (let n = Math.max(ci.getTime(), group.startDate.getTime()); n < Math.min(co.getTime(), group.endDate.getTime()); n += DAY) nightsInBlock.push(n);
  const countFor = async (db: Pick<typeof prisma, "reservation">) => {
    const live = await db.reservation.findMany({
      where: { groupBlockId: blockId, status: { notIn: ["CANCELLED", "NO_SHOW"] }, checkInDate: { lt: co }, checkOutDate: { gt: ci } },
      select: { checkInDate: true, checkOutDate: true },
    });
    let worst = 0;
    for (const n of nightsInBlock) {
      const c = live.filter((r) => toUtcMidnight(r.checkInDate).getTime() <= n && toUtcMidnight(r.checkOutDate).getTime() > n).length;
      worst = Math.max(worst, c);
    }
    return worst;
  };
  let elastic = nightsInBlock.length < Math.round((co.getTime() - ci.getTime()) / DAY);
  if (group.totalRoomsHeld > 0 && !acknowledgeOverbook) {
    const worst = await countFor(prisma);
    if (worst >= group.totalRoomsHeld) {
      if (worst >= group.totalRoomsHeld + group.elasticRooms) {
        return fail(
          409,
          `This block's ${group.totalRoomsHeld} held room${group.totalRoomsHeld > 1 ? "s are" : " is"} fully picked up${group.elasticRooms ? " including its flexible rooms" : ""}.`,
          "SLOT_FULL",
          !isAgent
        );
      }
      elastic = true;
    }
  }

  // The master folio: a DEFINITE block needs it; a TENTATIVE block may not have one yet, so
  // the guest keeps their own folio until the block goes definite.
  const masterFolio = group.masterFolios.find((f) => f.isMaster && !f.isClosed);
  if (!masterFolio && group.status === "DEFINITE") return fail(400, "Create the group's master folio before picking up rooms.");
  const groupBillToMaster = !!masterFolio && input.billToMaster !== false;

  const roomType = await prisma.roomType.findUnique({ where: { id: input.roomTypeId } });
  if (!roomType || roomType.propertyId !== group.propertyId) return fail(400, "Room type does not belong to this property");
  if (!roomType.isActive) return fail(400, "This room type is inactive and cannot accept new reservations");
  const heldTypes = new Set(group.roomHolds.filter((h) => h.quantity > 0).map((h) => h.roomTypeId));
  if (heldTypes.size > 0 && !heldTypes.has(input.roomTypeId)) {
    return fail(400, "That room type is not part of this block.", "SLOT_FULL");
  }
  if (input.roomId) {
    const room = await prisma.room.findUnique({ where: { id: input.roomId } });
    if (!room || room.propertyId !== group.propertyId || room.status === "OUT_OF_SERVICE") {
      return fail(400, "Room does not belong to this property or is out of service");
    }
  }

  const segments = [{ roomTypeId: input.roomTypeId, startDate: ci, endDate: co }];
  const stopSale = await findStopSaleConflicts({ propertyId: group.propertyId, segments });
  if (stopSale.length > 0) return fail(409, stopSale.join("; "), "CLOSED");

  // Pseudo types (an Overflow slot) are not judged on availability.
  let availabilityConflicts: string[] = [];
  if (!roomType.isPseudo) {
    availabilityConflicts = await findTypeAvailabilityConflicts({ propertyId: group.propertyId, segments, excludeGroupBlockId: blockId });
    if (availabilityConflicts.length > 0 && !acknowledgeOverbook) {
      return fail(409, availabilityConflicts.join("; "), elastic ? "SLOT_FULL" : "NO_AVAILABILITY", !isAgent);
    }
    if (availabilityConflicts.length > 0) {
      const limitError = await sellLimitGate(ctx, { propertyId: group.propertyId, segments, excludeGroupBlockId: blockId });
      if (limitError) return fail(409, limitError, "SELL_LIMIT");
    }
  }
  if (input.roomId && (await hasRoomConflict({ roomId: input.roomId, startDate: ci, endDate: co }))) {
    return fail(409, "That room is already booked for the selected dates");
  }

  const ratePlan = input.ratePlanId
    ? await prisma.ratePlan.findFirst({ where: { id: input.ratePlanId, propertyId: group.propertyId } })
    : await prisma.ratePlan.findFirst({ where: { propertyId: group.propertyId }, orderBy: { priority: "asc" } });
  if (!ratePlan) return fail(400, input.ratePlanId ? "Rate plan does not belong to this property" : "No rate plan configured for this property");

  const settings = await getPropertySettings(group.propertyId);
  const isTentative = input.status === "TENTATIVE";
  const optionDate = isTentative
    ? computeOptionDate({
        checkInDate: ci,
        now,
        blockCutoff: group.cutoffDate,
        optionDaysBeforeArrival: settings.optionDaysBeforeArrival,
        shortOptionHours: settings.shortOptionHours,
      })
    : null;

  const prefix = settings.resConfirmPrefix || `${group.property.code}-`;
  const length = settings.resConfirmLength || 6;
  let confirmationNo = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    const seq = await allocateSequenceNumber(group.propertyId, "REGISTRATION_NO");
    confirmationNo = `${prefix}${String(seq).padStart(length, "0")}`;
    const taken = await prisma.reservation.findUnique({ where: { confirmationNo }, select: { id: true } });
    if (!taken) break;
  }

  let reservation: { id: string; confirmationNo: string; status: string };
  try {
    reservation = await prisma.$transaction(async (tx) => {
      // Last room (Agent Portal plan §9): the same lock createReservation takes, then re-check.
      await lockKeys(tx, [`inventory:${group.propertyId}:${input.roomTypeId}`]);
      if (group.totalRoomsHeld > 0 && !acknowledgeOverbook) {
        const worst = await countFor(tx);
        if (worst >= group.totalRoomsHeld + group.elasticRooms) {
          throw new Raced(fail(409, "The last room in this block was just taken.", "SLOT_FULL"));
        }
      }
      if (!roomType.isPseudo && !acknowledgeOverbook && availabilityConflicts.length === 0) {
        const again = await findTypeAvailabilityConflicts({ propertyId: group.propertyId, segments, excludeGroupBlockId: blockId });
        if (again.length > 0) throw new Raced(fail(409, again.join("; "), "NO_AVAILABILITY", !isAgent));
      }

      let profileId = input.primaryGuestId ?? null;
      if (profileId) {
        const p = await tx.profile.findUnique({ where: { upid: profileId }, select: { enterpriseId: true } });
        if (!p || p.enterpriseId !== ctx.enterpriseId) throw new Raced(fail(404, "Guest profile not found"));
      } else {
        const existing = input.email
          ? await tx.profile.findFirst({
              where: { enterpriseId: group.property.enterpriseId, communications: { some: { type: "EMAIL", value: input.email } } },
            })
          : null;
        if (existing) profileId = existing.upid;
        else {
          const commRows = [
            ...(input.email ? [{ type: "EMAIL", value: input.email, isPrimary: true }] : []),
            ...(input.phone ? [{ type: "MOBILE", value: input.phone, isPrimary: !input.email }] : []),
          ];
          profileId = (
            await tx.profile.create({
              data: {
                enterpriseId: group.property.enterpriseId,
                profileType: "GUEST",
                firstName: input.firstName,
                lastName: input.lastName,
                communications: commRows.length > 0 ? { create: commRows } : undefined,
              },
            })
          ).upid;
        }
      }

      const r = await tx.reservation.create({
        data: {
          propertyId: group.propertyId,
          confirmationNo,
          primaryGuestId: profileId,
          groupBlockId: blockId,
          groupBillToMaster,
          checkInDate: ci,
          checkOutDate: co,
          adults: parseInt(String(input.adults ?? 1)) || 1,
          children: parseInt(String(input.children ?? 0)) || 0,
          infants: parseInt(String(input.infants ?? 0)) || 0,
          mealPlan: input.mealPlanCode || "NONE",
          remarks: input.remarks?.trim() || null,
          status: isTentative ? "TENTATIVE" : "RESERVED",
          optionDate,
          origin: input.origin ?? "GROUP_PICKUP",
          sourceProfileId: group.sourceProfileId,
          isOverflow: roomType.isPseudo && roomType.code === "OVF",
          ...(input.agentUserId ? { agentUserId: input.agentUserId } : {}),
          ...(input.packageName ? { packageName: input.packageName.slice(0, 120) } : {}),
          ...(input.agentReference ? { agentReference: input.agentReference.slice(0, 80) } : {}),
        },
        select: { id: true, confirmationNo: true, status: true },
      });
      await tx.roomAssignment.create({
        data: {
          reservationId: r.id,
          roomTypeId: input.roomTypeId,
          roomId: input.roomId || null,
          ratePlanId: ratePlan.id,
          startDate: ci,
          endDate: co,
        },
      });
      await tx.folio.create({ data: { reservationId: r.id, propertyId: group.propertyId } });
      return r;
    }, BOOKING_TX_OPTIONS);
  } catch (e) {
    if (e instanceof Raced) return e.result;
    throw e;
  }

  await logActivity({
    ctx,
    module: "GROUP_BLOCKS",
    action: "CREATE",
    entityType: "Reservation",
    entityId: reservation.id,
    description: `Group pickup ${confirmationNo} from block ${group.code} for ${input.firstName} ${input.lastName}${isTentative ? " (tentative)" : ""}${elastic ? " (flexible)" : ""}`,
  });

  const allocationResult = await materializeReservationAllocations({
    reservationId: reservation.id,
    propertyId: group.propertyId,
    segments: [{ ratePlanId: ratePlan.id, startDate: ci, endDate: co }],
    mealPlanCode: input.mealPlanCode || "NONE",
    manualAllocationIds: [],
  });
  return {
    ok: true,
    reservation,
    ...(allocationResult.error ? { allocationWarning: allocationResult.error } : {}),
    ...(elastic ? { elastic: true } : {}),
  };
}
