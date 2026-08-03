import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolveBusinessDate, toUtcMidnight } from "@/lib/business-date";
import { assertPropertyAccess, type AuthContext } from "@/lib/scope";
import { materializeReservationAllocations } from "@/lib/allocations-server";
import { validateSpecialRequestCodes } from "@/lib/special-requests";
import { findTypeAvailabilityConflicts, hasRoomConflict } from "@/lib/availability";
import { findStopSaleConflicts } from "@/lib/restrictions";
import { allocateSequenceNumber } from "@/lib/document-sequence";
import { logActivity } from "@/lib/activity-log";
import { assignmentsAreContiguous, detectScheduledRoomMove } from "@/lib/reservation-assignments";

// The reservation-creation service — extracted verbatim from POST /api/reservations so a
// second caller (the channel-manager inbound conversion path, see
// src/lib/channels/inbound/convert.ts) can create a real Reservation through the exact same
// rules a front-desk booking goes through, rather than a parallel, easily-divergent copy.
//
// Deliberately returns a plain result object rather than a NextResponse or a thrown HTTP
// error — this is called from contexts that have no request/response at all. The route is
// the only thing that knows about HTTP status codes; this only knows about reservations.
// assertPropertyAccess is the one exception: it throws ForbiddenError, which every caller
// already has to handle (the HTTP route via toErrorResponse; a background job the same way
// jobs/runner.ts handles any other thrown error), so re-wrapping it here would just be a
// second error-shape for callers to learn.

export type ReservationAssignmentInput = {
  roomTypeId: string;
  roomId?: string | null;
  ratePlanId: string;
  overrideRate?: number | null;
  startDate: string | Date;
  endDate: string | Date;
};

export type CreateReservationInput = {
  propertyId: string;
  primaryGuestId: string;
  checkInDate: string | Date;
  checkOutDate: string | Date;
  travelAgentId?: string | null;
  accompanyingGuestIds?: string[];
  specialRequestCodes?: unknown;
  assignments?: ReservationAssignmentInput[];
  // Single-segment shorthand, used when `assignments` is omitted.
  roomTypeId?: string;
  roomId?: string | null;
  ratePlanId?: string;
  overrideRate?: number | null;
  adults?: number | string;
  children?: number | string;
  infants?: number | string;
  mealPlan?: string;
  remarks?: string | null;
  /** The originating channel's own booking id — set only by the channel-conversion path
   *  (src/lib/channels/inbound/convert.ts). Staff-made reservations never carry one. */
  externalRef?: string | null;
  depositFeeRuleId?: string | null;
  cancellationFeeRuleId?: string | null;
  noShowFeeRuleId?: string | null;
  groupBlockId?: string | null;
  acknowledgeOverbook?: boolean;
  /** Skip the "arrival cannot predate the business date" floor. Set ONLY by the channel
   *  conversion path: an OTA has already confirmed that stay to the guest, so refusing it
   *  here would turn a real paid booking into a failed conversion. Same reasoning as
   *  acknowledgeOverbook — see D-7 rule 4. Never set from a staff-facing route. */
  allowPastArrival?: boolean;
  manualAllocationIds?: string[];
};

const RESERVATION_INCLUDE = {
  primaryGuest: true,
  travelAgent: true,
  accompanyingGuests: { include: { profile: true } },
  assignments: {
    include: {
      roomType: true,
      room: {
        include: {
          housekeepingTasks: {
            where: { taskType: "SPECIAL_REQUEST" as const },
            orderBy: { createdAt: "desc" as const },
          },
        },
      },
      ratePlan: true,
    },
  },
  folios: true,
  specialRequests: true,
} satisfies Prisma.ReservationInclude;

export type CreatedReservation = Prisma.ReservationGetPayload<{ include: typeof RESERVATION_INCLUDE }>;

export type CreateReservationResult =
  | {
      ok: true;
      reservation: CreatedReservation;
      capacityWarning?: string;
      overbookWarning?: string | null;
      allocationWarning?: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
      requiresOverbookConfirm?: boolean;
    };

function fail(status: number, error: string, requiresOverbookConfirm?: boolean): CreateReservationResult {
  return requiresOverbookConfirm ? { ok: false, status, error, requiresOverbookConfirm } : { ok: false, status, error };
}

export async function createReservation(ctx: AuthContext, body: CreateReservationInput): Promise<CreateReservationResult> {
  if (!body.propertyId || !body.primaryGuestId || !body.checkInDate || !body.checkOutDate) {
    return fail(400, "Missing required fields");
  }
  if (new Date(body.checkOutDate) <= new Date(body.checkInDate)) {
    return fail(400, "Check-out date must be after check-in date");
  }
  await assertPropertyAccess(ctx, body.propertyId);

  // Arrival can never predate the property's BUSINESS date. A booking arriving on a day
  // the property has already closed could never be checked in, and Night Audit would
  // never see it — it would sit as a permanent phantom arrival. The UI's date picker
  // enforces the same floor, but this is the real gate: the picker can be bypassed by
  // any direct API call. Business date, not the server's calendar date, because the
  // property's operational day is what the desk works in.
  const bookingProperty = await prisma.property.findUnique({
    where: { id: body.propertyId },
    select: { businessDate: true },
  });
  const businessDate = resolveBusinessDate(bookingProperty ?? {});
  if (!body.allowPastArrival && toUtcMidnight(new Date(body.checkInDate)) < businessDate) {
    return fail(
      400,
      `Arrival cannot be before the property's business date (${businessDate.toISOString().slice(0, 10)}).`
    );
  }

  const primaryGuest = await prisma.profile.findUnique({ where: { upid: body.primaryGuestId } });
  if (!primaryGuest || primaryGuest.enterpriseId !== ctx.enterpriseId) {
    return fail(404, "Guest profile not found");
  }

  // Defaults the initial folio's settlement method to City Ledger when the attached
  // TA/corporate profile is an activated credit account — staff can still override it
  // afterward in the Folio Panel; not re-evaluated on later edits so an override isn't
  // silently clobbered. payeeProfileId is set alongside it so the folio is
  // identifiable as this account's invoice throughout the stay (shown on printed
  // documents, etc) — the actual transfer to the account only happens at checkout
  // (see check-out/route.ts), not here.
  let initialSettlementMethod = "DIRECT";
  let initialPayeeProfileId: string | null = null;
  if (body.travelAgentId) {
    const travelAgent = await prisma.profile.findUnique({ where: { upid: body.travelAgentId } });
    if (!travelAgent || travelAgent.enterpriseId !== ctx.enterpriseId) {
      return fail(404, "Travel agent profile not found");
    }
    if (travelAgent.isCreditAccount) {
      initialSettlementMethod = "CITY_LEDGER";
      initialPayeeProfileId = travelAgent.upid;
    }
  }

  if (Array.isArray(body.accompanyingGuestIds) && body.accompanyingGuestIds.length > 0) {
    const accompanying = await prisma.profile.findMany({ where: { upid: { in: body.accompanyingGuestIds } } });
    if (accompanying.length !== body.accompanyingGuestIds.length || accompanying.some((p) => p.enterpriseId !== ctx.enterpriseId)) {
      return fail(404, "One or more accompanying guest profiles were not found");
    }
    // Hard cap: accompanying guests can't exceed the pax not already occupied by the
    // primary guest (adults + children, minus the primary guest's own slot).
    const maxAccompanying = Math.max(0, (parseInt(String(body.adults)) || 1) + (parseInt(String(body.children)) || 0) - 1);
    if (body.accompanyingGuestIds.length > maxAccompanying) {
      return fail(
        400,
        `Only ${maxAccompanying} accompanying guest(s) can be attached for ${body.adults} adult(s) and ${body.children || 0} child(ren).`
      );
    }
  }

  const specialRequests = await validateSpecialRequestCodes(ctx.enterpriseId, body.specialRequestCodes);
  if (!specialRequests.ok) {
    return fail(400, specialRequests.error);
  }

  const assignmentsInput: ReservationAssignmentInput[] = body.assignments
    ? body.assignments
    : [
        {
          roomTypeId: body.roomTypeId!,
          roomId: body.roomId || null,
          ratePlanId: body.ratePlanId!,
          overrideRate: body.overrideRate || null,
          startDate: new Date(body.checkInDate),
          endDate: new Date(body.checkOutDate),
        },
      ];

  // Hard rule: split-stay segments must be back-to-back with no gaps between them.
  if (!assignmentsAreContiguous(assignmentsInput)) {
    return fail(400, "Segments must run back-to-back with no gaps between stays.");
  }

  // Non-blocking: a room type whose maxOccupancy is exceeded by this reservation's
  // adults+children (infants don't count toward occupancy, same convention as Green
  // Tax) still books — front desk may legitimately override for a crib, rollaway,
  // etc. — but the response flags it so the UI can surface a warning.
  const totalOccupants = (parseInt(String(body.adults)) || 1) + (parseInt(String(body.children)) || 0);
  const overCapacityRoomTypes = new Set<string>();

  for (const a of assignmentsInput) {
    const [roomType, ratePlan, room] = await Promise.all([
      prisma.roomType.findUnique({ where: { id: a.roomTypeId } }),
      prisma.ratePlan.findUnique({ where: { id: a.ratePlanId } }),
      a.roomId ? prisma.room.findUnique({ where: { id: a.roomId } }) : Promise.resolve(null),
    ]);
    if (!roomType || roomType.propertyId !== body.propertyId) {
      return fail(400, "Room type does not belong to this property");
    }
    if (!roomType.isActive) {
      return fail(400, "This room type is inactive and cannot accept new reservations");
    }
    if (!ratePlan || ratePlan.propertyId !== body.propertyId) {
      return fail(400, "Rate plan does not belong to this property");
    }
    if (a.roomId && (!room || room.propertyId !== body.propertyId || room.status === "OUT_OF_SERVICE")) {
      return fail(400, "Room does not belong to this property or is out of service");
    }
    if (totalOccupants > roomType.maxOccupancy) {
      overCapacityRoomTypes.add(`${roomType.name} (max ${roomType.maxOccupancy})`);
    }
    // A specifically-requested room must actually be free for the segment's dates.
    if (a.roomId) {
      const roomTaken = await hasRoomConflict({
        roomId: a.roomId,
        startDate: new Date(a.startDate),
        endDate: new Date(a.endDate),
      });
      if (roomTaken) {
        return fail(409, `Room ${room?.roomNumber ?? ""} is already booked for the selected dates`);
      }
    }
  }

  const bookingSegments = assignmentsInput.map((a) => ({
    roomTypeId: a.roomTypeId,
    startDate: new Date(a.startDate),
    endDate: new Date(a.endDate),
  }));

  // Optional: attach this ordinary reservation to a group block. It must fit the block's
  // date window AND use only the block's held room types (the "blocked grid"). Attaching
  // makes it draw from the block's held inventory (excludeGroupBlockId below) and counts
  // toward the block's pickups. Guest keeps their own folio (not billed to master by
  // default — that's the explicit group-pickup path).
  let groupBlockId: string | null = null;
  if (body.groupBlockId) {
    const block = await prisma.groupBlock.findUnique({
      where: { id: body.groupBlockId },
      include: { roomHolds: { select: { roomTypeId: true } } },
    });
    if (!block || block.propertyId !== body.propertyId) {
      return fail(400, "Group block not found for this property");
    }
    if (block.status === "CANCELLED" || block.status === "LOST") {
      return fail(400, "That group block is closed.");
    }
    const ci = new Date(body.checkInDate);
    const co = new Date(body.checkOutDate);
    if (ci < block.startDate || co > block.endDate) {
      return fail(400, "Reservation dates must fall within the group block's date range.");
    }
    const heldTypes = new Set(block.roomHolds.map((h) => h.roomTypeId));
    const notHeld = [...new Set(bookingSegments.map((s) => s.roomTypeId))].filter((t) => !heldTypes.has(t));
    if (heldTypes.size > 0 && notHeld.length > 0) {
      return fail(400, "That room type is not part of this group block's held room types.");
    }
    groupBlockId = block.id;
  }

  // Stop-Sale is a HARD block (no acknowledge/override) — checked FIRST so a closed
  // date fails fast rather than after the soft overbook prompt below. A date closed for
  // a room type or property-wide cannot be sold.
  const stopSaleConflicts = await findStopSaleConflicts({ propertyId: body.propertyId, segments: bookingSegments });
  if (stopSaleConflicts.length > 0) {
    return fail(409, stopSaleConflicts.join("; "));
  }

  // Type-level overbooking is a SOFT warning: a property may deliberately oversell a
  // room type (see src/lib/availability.ts). Staff must acknowledge it (acknowledgeOverbook)
  // — the physical same-room double-booking guard below stays hard. First pass without
  // acknowledgement returns 409 + requiresOverbookConfirm so the UI can confirm.
  const availabilityConflicts = await findTypeAvailabilityConflicts({
    propertyId: body.propertyId,
    segments: bookingSegments,
    excludeGroupBlockId: groupBlockId ?? undefined,
  });
  if (availabilityConflicts.length > 0 && !body.acknowledgeOverbook) {
    return fail(409, availabilityConflicts.join("; "), true);
  }
  const overbookWarning = availabilityConflicts.length > 0 ? availabilityConflicts.join("; ") : null;

  // Optional per-reservation fee-rule selections (one per type). Each id, if given,
  // must be a rule of THIS property and the matching type — a bad id is rejected rather
  // than silently attached. Null = no rule of that type = no fee.
  const feeRuleSel: Record<"DEPOSIT" | "CANCELLATION" | "NO_SHOW", string | null> = {
    DEPOSIT: body.depositFeeRuleId || null,
    CANCELLATION: body.cancellationFeeRuleId || null,
    NO_SHOW: body.noShowFeeRuleId || null,
  };
  const selectedRuleIds = Object.values(feeRuleSel).filter(Boolean) as string[];
  if (selectedRuleIds.length > 0) {
    const rules = await prisma.propertyFeeRule.findMany({ where: { id: { in: selectedRuleIds }, propertyId: body.propertyId } });
    const byId = new Map(rules.map((r) => [r.id, r]));
    for (const [type, id] of Object.entries(feeRuleSel)) {
      if (id && byId.get(id)?.ruleType !== type) {
        return fail(400, "A selected fee rule is invalid for this property.");
      }
    }
  }

  // Fetch EnterpriseSettings to determine confirmation number format.
  const settings = await prisma.enterpriseSettings.findUnique({ where: { enterpriseId: ctx.enterpriseId } });

  // Sequential confirmation number via the Sequence Manager's REGISTRATION_NO
  // counter (Controls > Reservations) — the app owner's explicit "sequential
  // numbers only" rule; replaces the old Math.random() string, which could collide
  // (raw 500) and gave staff no usable reference ordering. Prefix and zero-pad
  // length come from EnterpriseSettings; when no prefix is configured, the
  // property's own (globally unique) code is used — confirmationNo is globally
  // unique while sequences are per-property, so a bare "000001" from two different
  // properties would otherwise collide.
  const bookedProperty = await prisma.property.findUnique({ where: { id: body.propertyId } });
  const prefix = settings?.resConfirmPrefix || `${bookedProperty?.code ?? "RES"}-`;
  const length = settings?.resConfirmLength || 6;
  let seq = await allocateSequenceNumber(body.propertyId, "REGISTRATION_NO");
  let confirmationNo = `${prefix}${String(seq).padStart(length, "0")}`;
  // confirmationNo is globally unique; pre-sequence reservations used random strings
  // that could (rarely) occupy a number we generate — skip past any taken value
  // rather than 500 on the unique constraint. Concurrent creates are safe without
  // this loop: the sequence increment itself is atomic, so they never share a seq.
  for (let attempt = 0; attempt < 5; attempt++) {
    const taken = await prisma.reservation.findUnique({ where: { confirmationNo }, select: { id: true } });
    if (!taken) break;
    seq = await allocateSequenceNumber(body.propertyId, "REGISTRATION_NO");
    confirmationNo = `${prefix}${String(seq).padStart(length, "0")}`;
  }

  const newReservation = await prisma.reservation.create({
    data: {
      confirmationNo,
      propertyId: body.propertyId,
      primaryGuestId: body.primaryGuestId,
      travelAgentId: body.travelAgentId,
      groupBlockId,
      // Attached-to-block reservations keep their own folio by default (the pickup
      // dialog is the explicit bill-to-master path).
      ...(groupBlockId ? { groupBillToMaster: false } : {}),
      checkInDate: new Date(body.checkInDate),
      checkOutDate: new Date(body.checkOutDate),
      adults: parseInt(String(body.adults)) || 1,
      children: parseInt(String(body.children)) || 0,
      infants: parseInt(String(body.infants)) || 0,
      mealPlan: body.mealPlan || "NONE",
      remarks: body.remarks || null,
      externalRef: body.externalRef || null,
      depositFeeRuleId: feeRuleSel.DEPOSIT,
      cancellationFeeRuleId: feeRuleSel.CANCELLATION,
      noShowFeeRuleId: feeRuleSel.NO_SHOW,
      status: "RESERVED", // Default status
      hasScheduledRoomMove: detectScheduledRoomMove(assignmentsInput),
      assignments: {
        create: assignmentsInput,
      },
      accompanyingGuests:
        Array.isArray(body.accompanyingGuestIds) && body.accompanyingGuestIds.length > 0
          ? { create: body.accompanyingGuestIds.map((id) => ({ profileId: id })) }
          : undefined,
      specialRequests:
        specialRequests.codes.length > 0 ? { create: specialRequests.codes.map((code) => ({ code })) } : undefined,
      // Auto-create the Master Folio (Window 1) for the reservation
      folios: {
        create: {
          folioNumber: 1,
          propertyId: body.propertyId,
          settlementMethod: initialSettlementMethod,
          payeeProfileId: initialPayeeProfileId,
        },
      },
    },
    include: RESERVATION_INCLUDE,
  });

  await logActivity({
    ctx,
    module: "RESERVATIONS",
    action: "CREATE",
    entityType: "Reservation",
    entityId: newReservation.id,
    description:
      `Created reservation ${confirmationNo} for ${primaryGuest.firstName} ${primaryGuest.lastName ?? ""}`.trim() +
      ` (${new Date(body.checkInDate).toISOString().slice(0, 10)} → ${new Date(body.checkOutDate).toISOString().slice(0, 10)})`,
  });

  // Materialize the allocation attachment set (rate plan + meal plan links, plus any
  // manually-picked add-ons) — the rows Night Audit will post from.
  const allocationResult = await materializeReservationAllocations({
    reservationId: newReservation.id,
    propertyId: body.propertyId,
    ratePlanId: assignmentsInput[0]?.ratePlanId ?? null,
    mealPlanCode: body.mealPlan || "NONE",
    manualAllocationIds: Array.isArray(body.manualAllocationIds) ? body.manualAllocationIds : [],
  });
  if (allocationResult.error) {
    // The reservation itself is valid — surface the add-on problem without losing it.
    return { ok: true, reservation: newReservation, allocationWarning: allocationResult.error };
  }

  const capacityWarning =
    overCapacityRoomTypes.size > 0
      ? `${totalOccupants} guests exceeds max occupancy for: ${Array.from(overCapacityRoomTypes).join(", ")}`
      : undefined;

  return { ok: true, reservation: newReservation, capacityWarning, overbookWarning };
}
