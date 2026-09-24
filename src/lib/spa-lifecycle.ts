import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertPropertyModuleAccess, hasPermission, type AuthContext } from "@/lib/scope";
import { postCharge, chargeCodeInclude } from "@/lib/posting/post-charge";
import { voidPostedCharge, actorDisplayName } from "@/lib/posting/void-charge";
import { resolveBusinessDate } from "@/lib/business-date";
import { ensureOpenShift } from "@/lib/cashier-shift";
import { combineAppointmentDateTime } from "@/lib/spa";
import { dayStart } from "@/lib/spa-availability";
import { round2 } from "@/lib/money";
import { logActivity } from "@/lib/activity-log";
import { BookingError } from "@/lib/booking-error";
import { spaAppointmentInclude } from "@/lib/spa-booking";
import { notifyBookingChange } from "@/lib/booking-events";

// The Spa appointment lifecycle after booking (SPA_PLAN.md §6 / §9, "Phase 5"):
//
//   CONFIRMED → CHECKED_IN → IN_TREATMENT → COMPLETED
//   TENTATIVE/CONFIRMED/CHECKED_IN → CANCELLED   (IN_TREATMENT → CANCELLED: override only)
//   CONFIRMED → NO_SHOW                          (after start + noShowGraceMinutes)
//
// Shared by the desk's session routes (src/app/api/spa/appointments/[id]/*) and, from
// Phase 3 of BOOKING_API_ADDONS_PLAN.md, the Booking API's guest self-cancel. What an actor
// may do is passed in as SpaAuthority rather than read from the session inside, because
// the API acts as a system actor with no role permissions of its own.
//
// Money rules (SpaSettings, all per property):
//  - Cancelling past `cancellationCutoffHours` needs the override and applies the
//    late-cancellation fee; before it, the whole charge is voided.
//  - A no-show applies the no-show fee; "NONE" means the guest is not charged.
//  - A fee is kept as, or re-posted from, the booking's own charge code so it lands in
//    the same revenue bucket. FULL keeps the original posting untouched.
//  - Voiding needs `canVoid` (CASHIERING update) and an open folio. Without either the
//    status still changes and the response says what cashiering must do — the same
//    graceful degradation Excursions' cancel has (EXCURSIONS_PLAN.md Phase 4).

export type SpaAuthority = {
  /** SPA delete — late cancellation, cancelling mid-treatment, waiving a fee. */
  canOverride: boolean;
  /** CASHIERING update — void a posted charge. */
  canVoid: boolean;
};

export function spaAuthorityFor(ctx: AuthContext): SpaAuthority {
  return { canOverride: hasPermission(ctx, "SPA", "delete"), canVoid: hasPermission(ctx, "CASHIERING", "update") };
}

export const SPA_CANCELLATION_REASONS = [
  "GUEST_REQUEST",
  "ILLNESS",
  "SCHEDULE_CONFLICT",
  "THERAPIST_UNAVAILABLE",
  "ROOM_UNAVAILABLE",
  "WEATHER",
  "DUPLICATE",
  "OTHER",
] as const;
export type SpaCancellationReason = (typeof SPA_CANCELLATION_REASONS)[number];

export type FeeType = "NONE" | "FULL" | "PERCENTAGE" | "FIXED";

/** The fee a policy charges against an appointment's price. Never negative, never more
 *  than the price itself. */
export function computeSpaPolicyFee(type: string, value: number | null | undefined, price: number): number {
  switch (type as FeeType) {
    case "FULL":
      return round2(price);
    case "PERCENTAGE":
      return round2(Math.min(price, Math.max(0, (price * (value ?? 0)) / 100)));
    case "FIXED":
      return round2(Math.min(price, Math.max(0, value ?? 0)));
    default:
      return 0;
  }
}

type LoadedAppointment = Prisma.SpaAppointmentGetPayload<{
  include: {
    folio: true;
    folioLineItem: true;
    property: true;
    treatment: { select: { chargeCodeId: true; name: true } };
    participants: { where: { participantIndex: 1 }; include: { reservation: { include: { folios: { where: { isClosed: false } } } } } };
  };
}>;

async function loadAppointment(ctx: AuthContext, id: string): Promise<LoadedAppointment> {
  const appointment = await prisma.spaAppointment.findUnique({
    where: { id },
    include: {
      folio: true,
      folioLineItem: true,
      property: true,
      treatment: { select: { chargeCodeId: true, name: true } },
      participants: {
        where: { participantIndex: 1 },
        include: { reservation: { include: { folios: { where: { isClosed: false } } } } },
      },
    },
  });
  if (!appointment) throw new BookingError(404, "APPOINTMENT_NOT_FOUND", "Appointment not found");
  await assertPropertyModuleAccess(ctx, appointment.propertyId, "SPA");
  return appointment;
}

/** Flip the status only if nobody else moved it first — the guard against two staff (or
 *  the desk and the Booking API) acting on the same appointment at once. */
async function transition(
  tx: Prisma.TransactionClient,
  id: string,
  from: readonly string[],
  data: Prisma.SpaAppointmentUncheckedUpdateManyInput
) {
  const { count } = await tx.spaAppointment.updateMany({ where: { id, appointmentStatus: { in: [...from] } }, data });
  if (count === 0) {
    throw new BookingError(409, "STATUS_CHANGED", "This appointment was changed by someone else — reload and try again");
  }
}

function assertStatus(appointment: { appointmentStatus: string }, allowed: readonly string[], action: string) {
  if (!allowed.includes(appointment.appointmentStatus)) {
    throw new BookingError(
      400,
      "INVALID_STATUS",
      `Cannot ${action} an appointment that is ${appointment.appointmentStatus.toLowerCase().replace("_", " ")}`
    );
  }
}

function appointmentStart(appointment: { appointmentDate: Date; startTime: string }): Date {
  return combineAppointmentDateTime(appointment.appointmentDate, appointment.startTime);
}

// ---------------------------------------------------------------------------------------
// Posting helpers

/** The folio a deferred (AT_COMPLETION) charge or a fee lands on: the appointment's own
 *  folio while still open, else participant 1's current open room folio, else — for a
 *  walk-in whose bill was closed meanwhile — a fresh walk-in folio in their name. */
async function resolveBillingFolioId(tx: Prisma.TransactionClient, appointment: LoadedAppointment): Promise<string> {
  if (appointment.folio && !appointment.folio.isClosed) return appointment.folio.id;
  const primary = appointment.participants[0];
  if (primary?.reservationId) {
    const open = primary.reservation?.folios[0];
    if (!open) throw new BookingError(400, "NO_OPEN_FOLIO", "The guest has no open folio to bill this appointment to");
    return open.id;
  }
  const folio = await tx.folio.create({
    data: {
      propertyId: appointment.propertyId,
      folioNumber: 1,
      walkInGuestName: primary?.walkInGuestName || "Walk-in guest",
      walkInGuestContact: primary?.walkInGuestContact ?? null,
    },
  });
  return folio.id;
}

async function postSpaCharge(
  tx: Prisma.TransactionClient,
  appointment: LoadedAppointment,
  input: { folioId: string; amount: number; description: string; shiftId: string }
) {
  // The property's own Spa Outlet (per property since 2026-09-23).
  const settings = await tx.propertySettings.findUnique({
    where: { propertyId: appointment.propertyId },
    include: { spaOutlet: { include: { taxProfile: { include: { rates: true } } } } },
  });
  const spaOutlet = settings?.spaOutlet ?? null;
  // No outlet, no posting (owner rule 2026-07-30).
  if (!spaOutlet) {
    throw new BookingError(
      400,
      "NO_OUTLET",
      "No Spa Outlet is linked — link one in the Hub (Charge Codes › Spa Outlet) before posting spa charges."
    );
  }
  const chargeCode = await tx.chargeCode.findUniqueOrThrow({
    where: { id: appointment.treatment.chargeCodeId },
    include: chargeCodeInclude(),
  });
  return postCharge(tx, {
    folioId: input.folioId,
    chargeCode,
    inputAmount: input.amount,
    settings,
    pricesIncludeTaxes: appointment.property.pricesIncludeTaxes,
    date: resolveBusinessDate(appointment.property),
    description: input.description,
    outlet: spaOutlet,
    outletId: spaOutlet.id,
    shiftId: input.shiftId,
    postingContext: { adults: appointment.partySize, children: 0, nights: 1 },
  });
}

type ChargeOutcome = {
  paymentStatus: string;
  folioId: string | null;
  folioLineItemId: string | null;
  chargeVoided: boolean;
  feeCharged: number;
  chargeNote: string;
};

/**
 * Settle the appointment's money when it ends without a completed treatment (cancel or
 * no-show), charging `fee` (0 = nothing) and releasing the rest.
 */
async function settleEndedAppointment(
  tx: Prisma.TransactionClient,
  ctx: AuthContext,
  appointment: LoadedAppointment,
  fee: number,
  authority: SpaAuthority,
  label: string
): Promise<ChargeOutcome> {
  const price = appointment.priceSnapshot;
  const line = appointment.folioLineItem;
  const posted = !!line && !line.isVoid;
  const wasPaid = appointment.paymentStatus === "PAID";
  const keep: ChargeOutcome = {
    paymentStatus: appointment.paymentStatus,
    folioId: appointment.folioId,
    folioLineItemId: appointment.folioLineItemId,
    chargeVoided: false,
    feeCharged: 0,
    chargeNote: "",
  };

  if (!posted) {
    // AT_COMPLETION (or an already-voided charge): nothing to release; post the fee if any.
    if (fee <= 0) return { ...keep, chargeNote: "No charge was posted for this appointment." };
    const shift = await ensureOpenShift(ctx, appointment.propertyId);
    const folioId = await resolveBillingFolioId(tx, appointment);
    const fresh = await postSpaCharge(tx, appointment, {
      folioId,
      amount: fee,
      description: `${label} fee — ${appointment.treatmentNameSnapshot} (${appointment.appointmentDate.toISOString().slice(0, 10)} ${appointment.startTime})`,
      shiftId: shift.id,
    });
    return {
      paymentStatus: "POSTED_TO_FOLIO",
      folioId,
      folioLineItemId: fresh.parent.id,
      chargeVoided: false,
      feeCharged: fee,
      chargeNote: `A ${label.toLowerCase()} fee of ${fee.toFixed(2)} was posted.`,
    };
  }

  if (fee >= price) {
    return { ...keep, feeCharged: price, chargeNote: `The charge was kept as the ${label.toLowerCase()} fee.` };
  }

  if (appointment.folio?.isClosed) {
    return {
      ...keep,
      paymentStatus: "REFUND_REQUIRED",
      chargeNote: "The bill is already closed — any refund must be handled manually.",
    };
  }
  if (!authority.canVoid) {
    return {
      ...keep,
      paymentStatus: "VOID_PENDING",
      chargeNote:
        fee > 0
          ? `The charge was left in place — cashiering access is required to void it and post the ${fee.toFixed(2)} ${label.toLowerCase()} fee.`
          : "The charge was left in place — cashiering access is required to void it.",
    };
  }

  await voidPostedCharge(tx, {
    lineItemId: line!.id,
    reason: `Spa ${label.toLowerCase()}`,
    actorName: await actorDisplayName(tx, ctx.userId),
  });
  if (fee <= 0) {
    return {
      paymentStatus: wasPaid ? "REFUND_REQUIRED" : "VOIDED",
      folioId: appointment.folioId,
      folioLineItemId: appointment.folioLineItemId,
      chargeVoided: true,
      feeCharged: 0,
      chargeNote: wasPaid
        ? "The posted charge was voided. The guest had already paid — refund them from the bill."
        : "The posted charge was voided.",
    };
  }
  // Partial fee: the original posting is reversed and the fee re-posted on its own, so
  // tax and service are recomputed on the fee rather than pro-rated by hand.
  const shift = await ensureOpenShift(ctx, appointment.propertyId);
  const fresh = await postSpaCharge(tx, appointment, {
    folioId: appointment.folio!.id,
    amount: fee,
    description: `${label} fee — ${appointment.treatmentNameSnapshot} (${appointment.appointmentDate.toISOString().slice(0, 10)} ${appointment.startTime})`,
    shiftId: shift.id,
  });
  return {
    paymentStatus: wasPaid ? "REFUND_REQUIRED" : "POSTED_TO_FOLIO",
    folioId: appointment.folio!.id,
    folioLineItemId: fresh.parent.id,
    chargeVoided: true,
    feeCharged: fee,
    chargeNote: `The charge was voided and a ${label.toLowerCase()} fee of ${fee.toFixed(2)} was posted.${
      wasPaid ? " The guest had already paid — refund the difference from the bill." : ""
    }`,
  };
}

// ---------------------------------------------------------------------------------------
// Transitions

export async function cancelSpaAppointment(
  ctx: AuthContext,
  id: string,
  input: { reasonCode?: string | null; notes?: string | null; waiveFee?: boolean },
  authority: SpaAuthority
) {
  // A reason, when given, must be one of the known codes. Whether one is REQUIRED is the
  // property's "Require cancellation reason" Spa setting (default on), checked below
  // once the appointment's property is known.
  const reasonCode = input.reasonCode?.trim() || null;
  if (reasonCode && !SPA_CANCELLATION_REASONS.includes(reasonCode as SpaCancellationReason)) {
    throw new BookingError(400, "VALIDATION", "A valid cancellation reason is required");
  }
  const notes = input.notes?.trim() || null;
  if (reasonCode === "OTHER" && !notes) {
    throw new BookingError(400, "VALIDATION", "Describe the reason when choosing Other");
  }

  const appointment = await loadAppointment(ctx, id);
  const cancellable = ["TENTATIVE", "CONFIRMED", "CHECKED_IN", "IN_TREATMENT"] as const;
  assertStatus(appointment, cancellable, "cancel");
  if (appointment.appointmentStatus === "IN_TREATMENT" && !authority.canOverride) {
    throw new BookingError(403, "OVERRIDE_REQUIRED", "The treatment has started — a manager override is required to cancel it");
  }

  const settings = await prisma.spaSettings.findUnique({ where: { propertyId: appointment.propertyId } });
  if (!reasonCode && (settings?.requireCancellationReason ?? true)) {
    throw new BookingError(400, "VALIDATION", "A cancellation reason is required");
  }
  const cutoffHours = settings?.cancellationCutoffHours ?? 4;
  const cutoffAt = new Date(appointmentStart(appointment).getTime() - cutoffHours * 3_600_000);
  const isLate = new Date() > cutoffAt;
  if (isLate && !authority.canOverride) {
    throw new BookingError(
      403,
      "CANCEL_CUTOFF_PASSED",
      `Past the ${cutoffHours}-hour cancellation cutoff — a manager override is required`
    );
  }
  if (input.waiveFee && !authority.canOverride) {
    throw new BookingError(403, "OVERRIDE_REQUIRED", "Waiving a fee requires a manager override");
  }
  const fee =
    isLate && !input.waiveFee
      ? computeSpaPolicyFee(settings?.lateCancellationChargeType ?? "NONE", settings?.lateCancellationChargeValue, appointment.priceSnapshot)
      : 0;

  const outcome = await prisma.$transaction(async (tx) => {
    const money = await settleEndedAppointment(tx, ctx, appointment, fee, authority, "Late cancellation");
    await transition(tx, id, cancellable, {
      appointmentStatus: "CANCELLED",
      cancelledAt: new Date(),
      cancelledByUserId: ctx.userId,
      cancellationReasonCode: reasonCode,
      cancellationNotes: notes,
      paymentStatus: money.paymentStatus,
      folioId: money.folioId,
      folioLineItemId: money.folioLineItemId,
    });
    return money;
  });

  await logActivity({
    ctx,
    module: "SPA",
    action: "UPDATE",
    entityType: "SpaAppointment",
    entityId: id,
    description: `Cancelled ${appointment.treatmentNameSnapshot} (${appointment.appointmentDate.toISOString().slice(0, 10)} ${appointment.startTime}) — ${reasonCode ?? "no reason given"}${notes ? `: ${notes}` : ""}${input.waiveFee && isLate ? " — fee waived" : ""}. ${outcome.chargeNote}`,
  });

  notifyBookingChange("booking.cancelled", { spaAppointmentId: id });
  return { ...outcome, lateCancellation: isLate, appointment: await reload(id) };
}

export async function markSpaNoShow(
  ctx: AuthContext,
  id: string,
  input: { waiveFee?: boolean; notes?: string | null },
  authority: SpaAuthority
) {
  const appointment = await loadAppointment(ctx, id);
  assertStatus(appointment, ["CONFIRMED"], "mark as no-show");

  const settings = await prisma.spaSettings.findUnique({ where: { propertyId: appointment.propertyId } });
  const graceMinutes = settings?.noShowGraceMinutes ?? 15;
  if (new Date() < new Date(appointmentStart(appointment).getTime() + graceMinutes * 60_000)) {
    throw new BookingError(
      400,
      "TOO_EARLY",
      `A no-show can only be marked ${graceMinutes} minute(s) after the scheduled start`
    );
  }
  const notes = input.notes?.trim() || null;
  if (input.waiveFee) {
    if (!authority.canOverride) throw new BookingError(403, "OVERRIDE_REQUIRED", "Waiving a fee requires a manager override");
    if (!notes) throw new BookingError(400, "VALIDATION", "A reason is required to waive the no-show fee");
  }
  const fee = input.waiveFee
    ? 0
    : computeSpaPolicyFee(settings?.noShowChargeType ?? "NONE", settings?.noShowChargeValue, appointment.priceSnapshot);

  const outcome = await prisma.$transaction(async (tx) => {
    const money = await settleEndedAppointment(tx, ctx, appointment, fee, authority, "No-show");
    await transition(tx, id, ["CONFIRMED"], {
      appointmentStatus: "NO_SHOW",
      noShowAt: new Date(),
      ...(notes ? { internalNotes: [appointment.internalNotes, `No-show: ${notes}`].filter(Boolean).join("\n") } : {}),
      paymentStatus: money.paymentStatus,
      folioId: money.folioId,
      folioLineItemId: money.folioLineItemId,
    });
    return money;
  });

  await logActivity({
    ctx,
    module: "SPA",
    action: "UPDATE",
    entityType: "SpaAppointment",
    entityId: id,
    description: `Marked ${appointment.treatmentNameSnapshot} (${appointment.appointmentDate.toISOString().slice(0, 10)} ${appointment.startTime}) as no-show${input.waiveFee ? ` — fee waived: ${notes}` : ""}. ${outcome.chargeNote}`,
  });

  notifyBookingChange("booking.no_show", { spaAppointmentId: id });
  return { ...outcome, appointment: await reload(id) };
}

export async function checkInSpaAppointment(ctx: AuthContext, id: string) {
  const appointment = await loadAppointment(ctx, id);
  assertStatus(appointment, ["CONFIRMED"], "check in");
  // Checking in a future day's appointment is almost always a mis-click on the wrong row.
  if (dayStart(appointment.appointmentDate) > dayStart(resolveBusinessDate(appointment.property))) {
    throw new BookingError(400, "TOO_EARLY", "This appointment is on a later day — it can be checked in on the day");
  }
  await transition(prisma, id, ["CONFIRMED"], { appointmentStatus: "CHECKED_IN", checkedInAt: new Date() });
  await logLifecycle(ctx, appointment, "Checked in");
  return { appointment: await reload(id) };
}

export async function startSpaTreatment(ctx: AuthContext, id: string) {
  const appointment = await loadAppointment(ctx, id);
  assertStatus(appointment, ["CHECKED_IN"], "start");
  await transition(prisma, id, ["CHECKED_IN"], { appointmentStatus: "IN_TREATMENT", treatmentStartedAt: new Date() });
  await logLifecycle(ctx, appointment, "Started treatment");
  return { appointment: await reload(id) };
}

/** Completes the treatment. Under AT_COMPLETION charge timing this is where the charge
 *  posts — from the priceSnapshot fixed at booking, never a re-resolved rate (SPA_PLAN.md §8). */
export async function completeSpaAppointment(ctx: AuthContext, id: string) {
  const appointment = await loadAppointment(ctx, id);
  const completable = ["CHECKED_IN", "IN_TREATMENT"] as const;
  assertStatus(appointment, completable, "complete");

  const needsPosting = appointment.paymentStatus === "NOT_POSTED";
  const shift = needsPosting ? await ensureOpenShift(ctx, appointment.propertyId) : null;

  const posting = await prisma.$transaction(async (tx) => {
    let money: { folioId: string; folioLineItemId: string } | null = null;
    if (needsPosting && shift) {
      const folioId = await resolveBillingFolioId(tx, appointment);
      const posted = await postSpaCharge(tx, appointment, {
        folioId,
        amount: appointment.priceSnapshot,
        description: `${appointment.treatmentNameSnapshot} — ${appointment.appointmentDate.toISOString().slice(0, 10)} ${appointment.startTime}${appointment.partySize > 1 ? ` (${appointment.partySize} guests)` : ""}`,
        shiftId: shift.id,
      });
      money = { folioId, folioLineItemId: posted.parent.id };
    }
    await transition(tx, id, completable, {
      appointmentStatus: "COMPLETED",
      completedAt: new Date(),
      completedByUserId: ctx.userId,
      ...(appointment.treatmentStartedAt ? {} : { treatmentStartedAt: new Date() }),
      ...(money ? { paymentStatus: "POSTED_TO_FOLIO", folioId: money.folioId, folioLineItemId: money.folioLineItemId } : {}),
    });
    return money;
  });

  await logLifecycle(ctx, appointment, posting ? "Completed and posted the charge for" : "Completed");
  notifyBookingChange("booking.completed", { spaAppointmentId: id });
  return { chargePosted: !!posting, appointment: await reload(id) };
}

async function logLifecycle(ctx: AuthContext, appointment: LoadedAppointment, verb: string) {
  await logActivity({
    ctx,
    module: "SPA",
    action: "UPDATE",
    entityType: "SpaAppointment",
    entityId: appointment.id,
    description: `${verb} ${appointment.treatmentNameSnapshot} (${appointment.appointmentDate.toISOString().slice(0, 10)} ${appointment.startTime})`,
  });
}

function reload(id: string) {
  return prisma.spaAppointment.findUniqueOrThrow({ where: { id }, include: spaAppointmentInclude });
}
