import { describe, it, expect } from "vitest";
import {
  isClosedReservation,
  canEditReservation,
  canReinstate,
  canReverseCheckOut,
  reservationRowToneClass,
} from "@/lib/reservation-state";

// What a booking that has left the live lifecycle is still allowed to do. These gates
// exist in one place so the list, the detail page and the API agree; they must stay in
// lockstep with the server guards in:
//   - PATCH /api/reservations/[id]/status  (reinstate date bounds)
//   - POST  /api/reservations/[id]/reverse-check-out
//   - PUT   /api/reservations/[id]         (checked-out is not editable)

const BD = "2026-08-05"; // the property's business date throughout

describe("Closed reservations — which statuses are closed", () => {
  it("treats cancelled, no-show and checked-out as closed", () => {
    expect(isClosedReservation("CANCELLED")).toBe(true);
    expect(isClosedReservation("NO_SHOW")).toBe(true);
    expect(isClosedReservation("CHECKED_OUT")).toBe(true);
  });

  it("leaves live bookings alone", () => {
    expect(isClosedReservation("RESERVED")).toBe(false);
    expect(isClosedReservation("IN_HOUSE")).toBe(false);
  });
});

describe("Closed reservations — editability", () => {
  it("keeps cancelled and no-show editable (they can still come back)", () => {
    expect(canEditReservation("CANCELLED")).toBe(true);
    expect(canEditReservation("NO_SHOW")).toBe(true);
  });

  it("never allows editing a departed stay", () => {
    expect(canEditReservation("CHECKED_OUT")).toBe(false);
  });

  it("leaves live bookings editable", () => {
    expect(canEditReservation("RESERVED")).toBe(true);
    expect(canEditReservation("IN_HOUSE")).toBe(true);
  });
});

describe("Reinstate — cancelled", () => {
  it("allows it while the arrival is still in the future", () => {
    expect(canReinstate("CANCELLED", "2026-08-06", "2026-08-09", BD)).toBe(true);
  });

  it("blocks it once the arrival is today — that's a fresh booking, not a reinstatement", () => {
    expect(canReinstate("CANCELLED", BD, "2026-08-08", BD)).toBe(false);
  });

  it("blocks it once the arrival has passed", () => {
    expect(canReinstate("CANCELLED", "2026-08-01", "2026-08-04", BD)).toBe(false);
  });
});

describe("Reinstate — no-show", () => {
  it("allows a late arrival while the stay period is still open", () => {
    expect(canReinstate("NO_SHOW", "2026-08-04", "2026-08-07", BD)).toBe(true);
  });

  it("allows it on the departure day itself", () => {
    expect(canReinstate("NO_SHOW", "2026-08-02", BD, BD)).toBe(true);
  });

  it("blocks it once the departure date has passed", () => {
    expect(canReinstate("NO_SHOW", "2026-08-01", "2026-08-04", BD)).toBe(false);
  });
});

describe("Reinstate — everything else", () => {
  it("is never offered on a live or departed booking", () => {
    expect(canReinstate("RESERVED", "2026-08-09", "2026-08-11", BD)).toBe(false);
    expect(canReinstate("IN_HOUSE", "2026-08-04", "2026-08-09", BD)).toBe(false);
    expect(canReinstate("CHECKED_OUT", "2026-08-01", BD, BD)).toBe(false);
  });

  it("stays closed when the property has no business date to compare against", () => {
    expect(canReinstate("CANCELLED", "2026-08-09", "2026-08-11", null)).toBe(false);
  });
});

describe("Reverse check-out", () => {
  it("allows it on the business day the guest actually departed", () => {
    expect(canReverseCheckOut("CHECKED_OUT", BD, BD, `${BD}T09:14:00.000Z`)).toBe(true);
  });

  it("blocks it once night audit has rolled past that day", () => {
    expect(canReverseCheckOut("CHECKED_OUT", "2026-08-04", BD, "2026-08-04T09:14:00.000Z")).toBe(false);
  });

  it("follows the actual departure, not the scheduled one, on an early check-out", () => {
    // Scheduled out on the 9th, guest actually left today → still correctable today.
    expect(canReverseCheckOut("CHECKED_OUT", "2026-08-09", BD, `${BD}T16:00:00.000Z`)).toBe(true);
    // Scheduled out today but the guest left two days ago → the day has closed.
    expect(canReverseCheckOut("CHECKED_OUT", BD, BD, "2026-08-03T16:00:00.000Z")).toBe(false);
  });

  it("falls back to the departure date for legacy rows with no checkedOutAt stamp", () => {
    expect(canReverseCheckOut("CHECKED_OUT", BD, BD, null)).toBe(true);
    expect(canReverseCheckOut("CHECKED_OUT", "2026-08-04", BD, null)).toBe(false);
  });

  it("is never offered on a booking that hasn't checked out", () => {
    expect(canReverseCheckOut("IN_HOUSE", BD, BD)).toBe(false);
    expect(canReverseCheckOut("CANCELLED", BD, BD)).toBe(false);
  });
});

describe("Closed-row tint", () => {
  it("gives each closed status its own subtle tone and live rows none", () => {
    expect(reservationRowToneClass("CANCELLED")).toContain("destructive");
    expect(reservationRowToneClass("NO_SHOW")).toContain("warning");
    expect(reservationRowToneClass("CHECKED_OUT")).toContain("muted");
    expect(reservationRowToneClass("RESERVED")).toBe("");
    expect(reservationRowToneClass("IN_HOUSE")).toBe("");
  });
});
