import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { materializeReservationAllocations } from "@/lib/allocations-server";
import { validateSpecialRequestCodes } from "@/lib/special-requests";
import { findTypeAvailabilityConflicts, hasRoomConflict } from "@/lib/availability";
import { findStopSaleConflicts } from "@/lib/restrictions";
import { logActivity } from "@/lib/activity-log";
import { assignmentsAreContiguous, detectScheduledRoomMove } from "@/lib/reservation-assignments";
import { checkHardDeleteGate, checkHardDeleteTarget, HARD_DELETE_FLAG } from "@/lib/reservations/hard-delete-gate";

const RESERVATION_DETAIL_INCLUDE = {
  primaryGuest: true,
  travelAgent: true,
  accompanyingGuests: { include: { profile: true } },
  assignments: {
    orderBy: { startDate: "asc" as const },
    include: {
      roomType: true,
      room: {
        include: {
          housekeepingTasks: {
            where: { taskType: "SPECIAL_REQUEST" },
            orderBy: { createdAt: "desc" as const },
          },
        },
      },
      ratePlan: true,
    },
  },
  allocations: {
    include: {
      allocation: {
        include: { rates: true, chargeCode: { select: { code: true } } },
      },
    },
  },
  specialRequests: true,
  transports: true,
  // If this reservation belongs to a group block, surface its code/name subtly on the detail view.
  groupBlock: { select: { id: true, code: true, name: true } },
  // Green Tax registration numbers assigned at EOD (Night Audit) — one per arriving guest
  // (primary + accompanying), surfaced per-guest on the detail screen.
  guestRegistrations: { select: { profileId: true, registrationNo: true, year: true, isPrimary: true } },
  // For the reservation detail page: folio balances and the trace log, slimmed to
  // what the summary cards actually render.
  folios: {
    include: {
      lineItems: { select: { amount: true, taxAmount: true, serviceChargeAmount: true, isVoid: true } },
      // depositPurpose/reference/method/date so collected deposits & fees can be shown
      // at a glance on the reservation screen (not just from the Deposit dialog).
      payments: {
        select: {
          id: true, amount: true, isRefund: true, depositPurpose: true,
          referenceNumber: true, createdAt: true,
          paymentMethod: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" as const },
      },
    },
  },
  traces: { orderBy: { createdAt: "desc" as const } },
} as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    const { id } = await params;

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: RESERVATION_DETAIL_INCLUDE,
    });
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, reservation.propertyId);

    return NextResponse.json(reservation);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

const updateSchema = z.object({
  primaryGuestId: z.string().min(1),
  // Multi-segment (split-stay) assignments — mirrors POST's shape. The reservation form
  // has supported multiple room segments per stay for a while; this schema previously
  // still required single top-level roomTypeId/ratePlanId fields the form never sent,
  // which made every edit through the UI 400.
  assignments: z.array(z.object({
    roomTypeId: z.string().min(1),
    roomId: z.string().optional().nullable(),
    ratePlanId: z.string().min(1),
    overrideRate: z.number().optional().nullable(),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
  })).min(1),
  checkInDate: z.string().min(1),
  checkOutDate: z.string().min(1),
  adults: z.number().or(z.string().transform(v => parseInt(v))),
  children: z.number().or(z.string().transform(v => parseInt(v))),
  infants: z.number().or(z.string().transform(v => parseInt(v))).optional(),
  mealPlan: z.string().optional(),
  remarks: z.string().optional().nullable(),
  travelAgentId: z.string().optional().nullable(),
  // Optional group-block association (null = detach). Validated against block dates + held types.
  groupBlockId: z.string().optional().nullable(),
  // Per-reservation fee-rule selections (PropertyFeeRule ids, one per type). Null clears.
  depositFeeRuleId: z.string().optional().nullable(),
  cancellationFeeRuleId: z.string().optional().nullable(),
  noShowFeeRuleId: z.string().optional().nullable(),
  accompanyingGuestIds: z.array(z.string()).optional(),
  manualAllocationIds: z.array(z.string()).optional(),
  specialRequestCodes: z.array(z.string()).optional(),
  // Optional and lifecycle-managed elsewhere — kept only so an older client that still
  // echoes the current status back doesn't 400 on the unknown-change guard below.
  status: z.string().optional()
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");

    const { id } = await params;
    const existing = await prisma.reservation.findUnique({
      where: { id },
      include: { assignments: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.propertyId);

    // A departed stay is financially settled: its folios are closed, any debtor invoice
    // is finalized and commission is posted. Editing dates/rooms/rates/pax behind that
    // would desync the booking from the money already accounted for, so a checked-out
    // reservation is view-only. The correction path is Reverse Check-out (same business
    // day), which unwinds the settlement first.
    if (existing.status === "CHECKED_OUT") {
      return NextResponse.json(
        { error: "A checked-out reservation can't be edited. Reverse the check-out first (same business day only)." },
        { status: 400 }
      );
    }

    const body = await request.json();

    // Parse and validate the body
    const data = updateSchema.parse(body);

    if (new Date(data.checkOutDate) <= new Date(data.checkInDate)) {
      return NextResponse.json({ error: "Check-out date must be after check-in date" }, { status: 400 });
    }

    // Hard rule: split-stay segments must be back-to-back with no gaps between them.
    if (!assignmentsAreContiguous(data.assignments)) {
      return NextResponse.json({ error: "Segments must run back-to-back with no gaps between stays." }, { status: 400 });
    }

    // Status is lifecycle-managed, never a plain editable field: check-in/check-out
    // have dedicated routes (room validation, settlement, debtor finalization) and
    // cancel/no-show/reinstate go through PATCH .../status (transition table +
    // financial guards). Accepting a different status here would silently bypass all
    // of that — the form omits status entirely (or echoes the current one back).
    if (data.status !== undefined && data.status !== existing.status) {
      return NextResponse.json(
        { error: "Reservation status cannot be changed here — use the Check-In / Check-Out / Cancel actions." },
        { status: 400 }
      );
    }

    const primaryGuest = await prisma.profile.findUnique({ where: { upid: data.primaryGuestId } });
    if (!primaryGuest || primaryGuest.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Guest profile not found" }, { status: 404 });
    }
    if (data.travelAgentId) {
      const travelAgent = await prisma.profile.findUnique({ where: { upid: data.travelAgentId } });
      if (!travelAgent || travelAgent.enterpriseId !== ctx.enterpriseId) {
        return NextResponse.json({ error: "Travel agent profile not found" }, { status: 404 });
      }
    }
    if (data.accompanyingGuestIds && data.accompanyingGuestIds.length > 0) {
      const accompanying = await prisma.profile.findMany({ where: { upid: { in: data.accompanyingGuestIds } } });
      if (accompanying.length !== data.accompanyingGuestIds.length || accompanying.some((p) => p.enterpriseId !== ctx.enterpriseId)) {
        return NextResponse.json({ error: "One or more accompanying guest profiles were not found" }, { status: 404 });
      }
      // Hard cap: accompanying guests can't exceed the pax not already occupied by the
      // primary guest (adults + children, minus the primary guest's own slot).
      const maxAccompanying = Math.max(0, data.adults - 1 + data.children);
      if (data.accompanyingGuestIds.length > maxAccompanying) {
        return NextResponse.json({ error: `Only ${maxAccompanying} accompanying guest(s) can be attached for ${data.adults} adult(s) and ${data.children} child(ren).` }, { status: 400 });
      }
    }

    const specialRequests = await validateSpecialRequestCodes(ctx.enterpriseId, data.specialRequestCodes);
    if (!specialRequests.ok) {
      return NextResponse.json({ error: specialRequests.error }, { status: 400 });
    }

    // Only enforced for a room type/room not already on this reservation — a segment
    // already sitting in a room whose type has since been deactivated can still be
    // edited (dates, other segments, etc.) without being blocked by that.
    for (const a of data.assignments) {
      const [roomType, ratePlan, room] = await Promise.all([
        prisma.roomType.findUnique({ where: { id: a.roomTypeId } }),
        prisma.ratePlan.findUnique({ where: { id: a.ratePlanId } }),
        a.roomId ? prisma.room.findUnique({ where: { id: a.roomId } }) : Promise.resolve(null),
      ]);
      if (!roomType || roomType.propertyId !== existing.propertyId) {
        return NextResponse.json({ error: "Room type does not belong to this property" }, { status: 400 });
      }
      const isExistingRoomType = existing.assignments.some((ex) => ex.roomTypeId === a.roomTypeId);
      if (!isExistingRoomType && !roomType.isActive) {
        return NextResponse.json({ error: "This room type is inactive and cannot accept new reservations" }, { status: 400 });
      }
      if (!ratePlan || ratePlan.propertyId !== existing.propertyId) {
        return NextResponse.json({ error: "Rate plan does not belong to this property" }, { status: 400 });
      }
      if (a.roomId && (!room || room.propertyId !== existing.propertyId)) {
        return NextResponse.json({ error: "Room does not belong to this property" }, { status: 400 });
      }
      const isExistingRoom = existing.assignments.some((ex) => ex.roomId === a.roomId);
      if (a.roomId && !isExistingRoom && room?.status === "OUT_OF_SERVICE") {
        return NextResponse.json({ error: "That room is out of service" }, { status: 400 });
      }
      // A specifically-requested room must be free of OTHER reservations' assignments
      // for the segment's dates (this reservation's own current assignments are
      // excluded — they're about to be replaced below).
      if (a.roomId) {
        const roomTaken = await hasRoomConflict({
          roomId: a.roomId,
          startDate: new Date(a.startDate),
          endDate: new Date(a.endDate),
          excludeReservationId: id,
        });
        if (roomTaken) {
          return NextResponse.json(
            { error: `Room ${room?.roomNumber ?? ""} is already booked for the selected dates` },
            { status: 409 }
          );
        }
      }
    }

    const editSegments = data.assignments.map((a) => ({
      roomTypeId: a.roomTypeId,
      startDate: new Date(a.startDate),
      endDate: new Date(a.endDate),
    }));

    // Stop-Sale is a HARD block (no override) — checked FIRST so a closed date fails fast
    // before the soft overbook prompt. Only nights/room-types this edit NEWLY sells count;
    // a segment the reservation already held on a since-closed date is exempt.
    const stopSaleConflicts = await findStopSaleConflicts({
      propertyId: existing.propertyId,
      segments: editSegments,
      existingSegments: existing.assignments.map((a) => ({
        roomTypeId: a.roomTypeId,
        startDate: a.startDate,
        endDate: a.endDate,
      })),
    });
    if (stopSaleConflicts.length > 0) {
      return NextResponse.json({ error: stopSaleConflicts.join("; ") }, { status: 409 });
    }

    // Type-level overbooking guard (excluding this reservation's own existing assignments)
    // — an edit that grows the stay or switches room type must still fit the property's
    // sellable inventory. Soft, acknowledgeable (physical room conflicts above stay hard).
    const availabilityConflicts = await findTypeAvailabilityConflicts({
      propertyId: existing.propertyId,
      segments: editSegments,
      excludeReservationId: id,
    });
    if (availabilityConflicts.length > 0 && !(body as { acknowledgeOverbook?: boolean }).acknowledgeOverbook) {
      return NextResponse.json(
        { error: availabilityConflicts.join("; "), requiresOverbookConfirm: true },
        { status: 409 }
      );
    }

    // Group-block association (optional): a reservation attached to a block must fit its
    // date window and use only its held room types (the "blocked grid").
    if (data.groupBlockId) {
      const block = await prisma.groupBlock.findUnique({
        where: { id: data.groupBlockId },
        include: { roomHolds: { select: { roomTypeId: true } } },
      });
      if (!block || block.propertyId !== existing.propertyId) {
        return NextResponse.json({ error: "Group block not found for this property" }, { status: 400 });
      }
      if (block.status === "CANCELLED" || block.status === "LOST") {
        return NextResponse.json({ error: "That group block is closed." }, { status: 400 });
      }
      if (new Date(data.checkInDate) < block.startDate || new Date(data.checkOutDate) > block.endDate) {
        return NextResponse.json({ error: "Reservation dates must fall within the group block's date range." }, { status: 400 });
      }
      const heldTypes = new Set(block.roomHolds.map((h) => h.roomTypeId));
      const notHeld = [...new Set(data.assignments.map((a) => a.roomTypeId))].filter((t) => !heldTypes.has(t));
      if (heldTypes.size > 0 && notHeld.length > 0) {
        return NextResponse.json({ error: "That room type is not part of this group block's held room types." }, { status: 400 });
      }
    }

    // Validate any per-reservation fee-rule selections against this property + type
    // (mirrors the create route). Only fields the client actually sent are touched.
    const feeRuleSel: Partial<Record<"DEPOSIT" | "CANCELLATION" | "NO_SHOW", string | null>> = {};
    if (data.depositFeeRuleId !== undefined) feeRuleSel.DEPOSIT = data.depositFeeRuleId || null;
    if (data.cancellationFeeRuleId !== undefined) feeRuleSel.CANCELLATION = data.cancellationFeeRuleId || null;
    if (data.noShowFeeRuleId !== undefined) feeRuleSel.NO_SHOW = data.noShowFeeRuleId || null;
    const selectedRuleIds = Object.values(feeRuleSel).filter(Boolean) as string[];
    if (selectedRuleIds.length > 0) {
      const rules = await prisma.propertyFeeRule.findMany({ where: { id: { in: selectedRuleIds }, propertyId: existing.propertyId } });
      const byId = new Map(rules.map((r) => [r.id, r]));
      for (const [type, id] of Object.entries(feeRuleSel)) {
        if (id && byId.get(id)?.ruleType !== type) {
          return NextResponse.json({ error: "A selected fee rule is invalid for this property." }, { status: 400 });
        }
      }
    }

    const updatedReservation = await prisma.reservation.update({
      where: { id },
      data: {
        primaryGuestId: data.primaryGuestId,
        checkInDate: new Date(data.checkInDate),
        checkOutDate: new Date(data.checkOutDate),
        adults: data.adults,
        children: data.children,
        ...(data.infants !== undefined && { infants: data.infants }),
        mealPlan: data.mealPlan,
        ...(data.remarks !== undefined && { remarks: data.remarks }),
        travelAgentId: data.travelAgentId,
        ...(data.groupBlockId !== undefined && { groupBlockId: data.groupBlockId || null }),
        ...(data.depositFeeRuleId !== undefined && { depositFeeRuleId: data.depositFeeRuleId || null }),
        ...(data.cancellationFeeRuleId !== undefined && { cancellationFeeRuleId: data.cancellationFeeRuleId || null }),
        ...(data.noShowFeeRuleId !== undefined && { noShowFeeRuleId: data.noShowFeeRuleId || null }),
        status: data.status,
        hasScheduledRoomMove: detectScheduledRoomMove(data.assignments),
        assignments: {
          deleteMany: {},
          create: data.assignments.map((a) => ({
            roomTypeId: a.roomTypeId,
            roomId: a.roomId || null,
            ratePlanId: a.ratePlanId,
            overrideRate: a.overrideRate ?? null,
            startDate: new Date(a.startDate),
            endDate: new Date(a.endDate),
          }))
        },
        ...(data.accompanyingGuestIds !== undefined && {
          accompanyingGuests: {
            deleteMany: {},
            create: data.accompanyingGuestIds.map((id: string) => ({ profileId: id }))
          }
        }),
        ...(data.specialRequestCodes !== undefined && {
          specialRequests: {
            deleteMany: {},
            create: specialRequests.codes.map((code) => ({ code }))
          }
        })
      },
      include: {
        primaryGuest: true,
        travelAgent: true,
        accompanyingGuests: { include: { profile: true } },
        assignments: {
          include: { roomType: true, room: true, ratePlan: true }
        },
        specialRequests: true,
      }
    });

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "UPDATE",
      entityType: "Reservation",
      entityId: id,
      description: `Updated reservation ${updatedReservation.confirmationNo} (${new Date(data.checkInDate).toISOString().slice(0, 10)} → ${new Date(data.checkOutDate).toISOString().slice(0, 10)}, ${data.adults} adult${data.adults === 1 ? "" : "s"})`,
    });

    // Re-derive rate-plan/meal-plan allocation rows against the edited values; MANUAL
    // rows are replaced only when the client sent manualAllocationIds, otherwise kept.
    const allocationResult = await materializeReservationAllocations({
      reservationId: id,
      propertyId: existing.propertyId,
      ratePlanId: data.assignments[0]?.ratePlanId ?? null,
      mealPlanCode: data.mealPlan || "NONE",
      manualAllocationIds: data.manualAllocationIds,
    });
    if (allocationResult.error) {
      return NextResponse.json({ ...updatedReservation, allocationWarning: allocationResult.error });
    }

    return NextResponse.json(updatedReservation);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "delete");

    const { id } = await params;
    const existing = await prisma.reservation.findUnique({
      where: { id },
      include: { folios: { include: { lineItems: true, payments: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.propertyId);

    // Internal-maintenance gate — see src/lib/reservations/hard-delete-gate.ts. There is
    // no delete button anywhere in the UI; this path exists only for Osta staff cleaning
    // up bad data, behind a kill switch that is off by default and an explicit
    // confirmation-number echo. Everyone else cancels.
    const body = await request.json().catch(() => ({}));
    const gate = checkHardDeleteGate({
      flag: process.env[HARD_DELETE_FLAG],
      isInternal: ctx.isInternal,
      confirmationNo: existing.confirmationNo,
      suppliedConfirmation: (body as { confirm?: unknown })?.confirm,
    });
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    // Gate 4 — is this booking destroyable at all? Even authorized internal staff must
    // not be able to erase money or a stay that actually happened.
    const target = checkHardDeleteTarget({
      status: existing.status,
      hasFinancialHistory: existing.folios.some(
        (f) => f.lineItems.length > 0 || f.payments.length > 0
      ),
    });
    if (!target.ok) {
      return NextResponse.json({ error: target.error }, { status: target.status });
    }

    await prisma.reservation.delete({
      where: { id },
    });
    // The row is gone, so this log line is the only surviving record of it — spell out
    // who destroyed it and under what authority.
    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "DELETE",
      entityType: "Reservation",
      entityId: id,
      description:
        `HARD DELETE of reservation ${existing.confirmationNo} by internal staff ` +
        `(no financial history)` +
        (ctx.isActingAsSupport ? ` — via support grant ${ctx.supportGrantId}` : ""),
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
