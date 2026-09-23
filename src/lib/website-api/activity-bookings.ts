import { prisma } from "@/lib/db";
import { BookingError } from "@/lib/booking-error";
import { cancelDeadline, cancelExcursionBooking } from "@/lib/excursion-booking";
import { cancelSpaAppointment } from "@/lib/spa-lifecycle";
import { combineAppointmentDateTime } from "@/lib/spa";
import { systemActorContext } from "@/lib/system-actor";
import type { ResolvedWebsiteKey } from "@/lib/website-api/resolve-key";
import { requireScope, type ActivityModule } from "@/lib/website-api/scopes";

// "My booking" for Excursion and Spa bookings made through the Booking API: lookup and
// guest self-cancel by public reference + email (BOOKING_API_ADDONS_PLAN.md B-7, B-11).
//
// Live status is always read from the booking itself, never from the ApiActivityBooking
// row, so whatever the desk did — cancelled the departure for weather, moved the guest to
// another departure, marked a no-show — is what the website sees.

const recordInclude = {
  property: { select: { id: true, name: true } },
  excursionBooking: {
    include: {
      departure: { include: { excursionType: { select: { id: true, name: true, cutoffHours: true } } } },
    },
  },
} as const;

/**
 * An excursion booking the desk moved to a replacement departure is cancelled and points
 * at its replacement (movedToBookingId). Follow the chain to the booking that is live now.
 */
async function liveExcursionBooking(bookingId: string) {
  let current = await prisma.excursionBooking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { departure: { include: { excursionType: { select: { id: true, name: true, cutoffHours: true } } } } },
  });
  let moved = false;
  for (let hops = 0; current.movedToBookingId && hops < 10; hops++) {
    current = await prisma.excursionBooking.findUniqueOrThrow({
      where: { id: current.movedToBookingId },
      include: { departure: { include: { excursionType: { select: { id: true, name: true, cutoffHours: true } } } } },
    });
    moved = true;
  }
  return { booking: current, moved };
}

/** The booking object every activity endpoint returns. */
export async function activityBookingResult(recordId: string, opts: { replayed: boolean }) {
  const record = await prisma.apiActivityBooking.findUniqueOrThrow({ where: { id: recordId }, include: recordInclude });
  const base = {
    reference: record.publicRef,
    module: record.module,
    replayed: opts.replayed,
    property: record.property,
    guest: { firstName: record.guestFirstName, lastName: record.guestLastName, email: record.guestEmail },
    payment: { status: record.paymentStatus, reference: record.paymentReference },
    total: { grandTotal: record.quotedTotal, currency: record.currency },
  };

  if (record.module === "EXCURSIONS" && record.excursionBookingId) {
    const { booking, moved } = await liveExcursionBooking(record.excursionBookingId);
    const deadline = cancelDeadline(booking.departure, booking.departure.excursionType.cutoffHours);
    const cancelled = booking.status === "CANCELLED";
    return {
      ...base,
      // CONFIRMED | CANCELLED | COMPLETED | NO_SHOW
      status: booking.status,
      moved,
      excursion: { id: booking.departure.excursionType.id, name: booking.departure.excursionType.name },
      departure: {
        id: booking.departure.id,
        date: booking.departure.departureDate.toISOString().slice(0, 10),
        time: booking.departure.departureTime,
        meetingTime: booking.departure.meetingTime,
        meetingPoint: booking.departure.meetingPoint,
      },
      adults: booking.adultCount,
      children: booking.childCount,
      infants: booking.infantCount,
      cancellation: {
        allowed: booking.status === "CONFIRMED" && new Date() < deadline,
        freeUntil: deadline.toISOString(),
        cancelledAt: booking.cancelledAt?.toISOString() ?? null,
        // The guest paid the website; the website refunds them through its own provider.
        refundRequired: cancelled && record.paymentStatus === "PAID",
      },
    };
  }
  if (record.module === "SPA" && record.spaAppointmentId) {
    const appt = await prisma.spaAppointment.findUniqueOrThrow({
      where: { id: record.spaAppointmentId },
      include: { participants: { orderBy: { participantIndex: "asc" }, select: { walkInGuestName: true } } },
    });
    const deadline = await spaCancelDeadline(appt);
    return {
      ...base,
      // CONFIRMED | CHECKED_IN | IN_TREATMENT | COMPLETED | NO_SHOW | CANCELLED
      status: appt.appointmentStatus,
      treatment: { id: appt.treatmentId, name: appt.treatmentNameSnapshot },
      date: appt.appointmentDate.toISOString().slice(0, 10),
      startTime: appt.startTime,
      endTime: appt.treatmentEndTime,
      partySize: appt.partySize,
      guests: appt.participants.map((p) => p.walkInGuestName),
      cancellation: {
        allowed: appt.appointmentStatus === "CONFIRMED" && new Date() < deadline,
        freeUntil: deadline.toISOString(),
        cancelledAt: appt.cancelledAt?.toISOString() ?? null,
        refundRequired: appt.appointmentStatus === "CANCELLED" && record.paymentStatus === "PAID",
      },
    };
  }
  throw new BookingError(404, "BOOKING_NOT_FOUND", "Booking not found.");
}

/** When free cancellation of a spa appointment closes (SpaSettings.cancellationCutoffHours). */
async function spaCancelDeadline(appt: { propertyId: string; appointmentDate: Date; startTime: string }): Promise<Date> {
  const s = await prisma.spaSettings.findUnique({ where: { propertyId: appt.propertyId }, select: { cancellationCutoffHours: true } });
  const hours = s?.cancellationCutoffHours ?? 4;
  return new Date(combineAppointmentDateTime(appt.appointmentDate, appt.startTime).getTime() - hours * 3_600_000);
}

/**
 * The record for `reference` under this key, if the email matches. A wrong email reads
 * exactly like an unknown reference, so a reference alone reveals nothing.
 */
async function findForGuest(key: ResolvedWebsiteKey, reference: string, email: string) {
  const record = await prisma.apiActivityBooking.findUnique({ where: { publicRef: reference.trim().toUpperCase() } });
  const matches =
    !!record &&
    record.keyId === key.id &&
    record.status === "CONFIRMED" &&
    !!record.guestEmail &&
    record.guestEmail === email.trim().toLowerCase() &&
    key.propertyIds.includes(record.propertyId);
  if (!record || !matches) throw new BookingError(404, "BOOKING_NOT_FOUND", "No booking matches that reference and email.");
  requireScope(key, record.module as ActivityModule);
  return record;
}

export async function lookupActivityBooking(key: ResolvedWebsiteKey, reference: string, email: string | null) {
  if (!email) throw new BookingError(400, "VALIDATION", "email is required", { details: { email: "Required" } });
  const record = await findForGuest(key, reference, email);
  return { booking: await activityBookingResult(record.id, { replayed: false }) };
}

/**
 * Guest self-cancel, before the free-cancellation deadline only. Past it the guest must
 * contact the property (the desk's manager override). The charge is voided on the bill;
 * if the website reported the booking as paid, the result says a refund is due — the
 * refund itself is the website's, through its own payment provider.
 */
export async function cancelActivityBooking(
  key: ResolvedWebsiteKey,
  reference: string,
  input: { email: string; reason?: string | null }
) {
  if (key.allowedOrigins.length > 0) {
    throw new BookingError(403, "SERVER_KEY_REQUIRED", "Cancellations must be made from your website's server with a server-only key.");
  }
  const record = await findForGuest(key, reference, input.email);
  const actor = await systemActorContext(key.enterpriseId);
  const reason = `Cancelled online by the guest${input.reason?.trim() ? `: ${input.reason.trim()}` : ""}`;

  if (record.module === "EXCURSIONS" && record.excursionBookingId) {
    const { booking } = await liveExcursionBooking(record.excursionBookingId);
    if (booking.status !== "CONFIRMED") {
      throw new BookingError(409, "ALREADY_CANCELLED", `This booking is ${booking.status.toLowerCase().replace("_", " ")} and can't be cancelled.`);
    }
    if (new Date() >= cancelDeadline(booking.departure, booking.departure.excursionType.cutoffHours)) {
      throw new BookingError(409, "CANCEL_CUTOFF_PASSED", "It's too late to cancel online. Please contact the property.");
    }
    // The system actor may void (the booking is its own, on a bill it opened) but never
    // override the cutoff — that stays a manager's decision at the desk.
    await cancelExcursionBooking(actor, booking.id, { reason }, { canOverride: false, canVoid: true });
    if (record.paymentStatus === "PAID") {
      // The payment stays on the bill as a credit until the refund is recorded — tell the
      // desk why, where they will look.
      await prisma.excursionBooking.update({
        where: { id: booking.id },
        data: {
          notes: [booking.notes, `Cancelled online: the website refunds the guest${record.paymentReference ? ` (payment ref ${record.paymentReference})` : ""} — record the refund on this bill.`]
            .filter(Boolean)
            .join("\n"),
        },
      });
    }
    return { booking: await activityBookingResult(record.id, { replayed: false }) };
  }
  if (record.module === "SPA" && record.spaAppointmentId) {
    const appt = await prisma.spaAppointment.findUniqueOrThrow({ where: { id: record.spaAppointmentId } });
    if (appt.appointmentStatus !== "CONFIRMED") {
      throw new BookingError(409, "ALREADY_CANCELLED", `This booking is ${appt.appointmentStatus.toLowerCase().replace("_", " ")} and can't be cancelled online.`);
    }
    if (new Date() >= (await spaCancelDeadline(appt))) {
      throw new BookingError(409, "CANCEL_CUTOFF_PASSED", "It's too late to cancel online. Please contact the property.");
    }
    // Same rule as excursions: the system actor may void its own charge, never override.
    // The lifecycle marks a paid booking REFUND_REQUIRED for the desk.
    await cancelSpaAppointment(actor, appt.id, { reasonCode: "GUEST_REQUEST", notes: reason }, { canOverride: false, canVoid: true });
    return { booking: await activityBookingResult(record.id, { replayed: false }) };
  }
  throw new BookingError(404, "BOOKING_NOT_FOUND", "Booking not found.");
}
