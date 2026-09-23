// Tell interested websites that a booking changed (Booking API webhooks — see
// src/lib/website-api/webhooks.ts). Called by the booking services and routes AFTER their
// transaction commits, for every status change whoever makes it: desk or website.
//
// Loaded lazily: the webhook module renders the public booking object, which imports the
// booking services that call this — a static import would make that a cycle. Fire and
// forget by design: nothing a website's endpoint does may slow down or fail the desk.

export type BookingEvent = "booking.confirmed" | "booking.cancelled" | "booking.moved" | "booking.completed" | "booking.no_show";
export type BookingEventSource = { excursionBookingId: string } | { spaAppointmentId: string };

export function notifyBookingChange(event: BookingEvent, source: BookingEventSource): void {
  void import("@/lib/website-api/webhooks")
    .then((m) => m.emitBookingEvent(event, source))
    .catch((e) => console.error("[booking-api webhooks] could not load", e));
}
