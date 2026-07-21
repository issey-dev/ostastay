import { describe, it, expect } from "vitest";
import { bookingFormSchema, emptyBookingValues, emptySegment } from "@/components/reservations/booking-form-schema";

// The booking form's Zod schema (APP STANDARD 001 rebuild) — these are the
// rules the old form checked imperatively in handleSubmit; they must hold
// identically now that they gate inline validation.

const validBooking = () => ({
  ...emptyBookingValues(),
  primaryGuestId: "guest-1",
  checkInDate: "2026-12-01",
  checkOutDate: "2026-12-03",
  assignments: [
    { ...emptySegment(), roomTypeId: "rt-1", ratePlanId: "rp-1", startDate: "2026-12-01", endDate: "2026-12-03" },
  ],
});

const issuePaths = (result: ReturnType<typeof bookingFormSchema.safeParse>) =>
  result.success ? [] : result.error.issues.map((i) => i.path.join("."));

describe("Booking form schema", () => {
  it("accepts a complete single-segment booking", () => {
    expect(bookingFormSchema.safeParse(validBooking()).success).toBe(true);
  });

  it("requires a primary guest", () => {
    const result = bookingFormSchema.safeParse({ ...validBooking(), primaryGuestId: "" });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("primaryGuestId");
  });

  it("requires room type and rate plan on every segment", () => {
    const booking = validBooking();
    booking.assignments[0].roomTypeId = "";
    const result = bookingFormSchema.safeParse(booking);
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("assignments.0.roomTypeId");
  });

  it("rejects a departure on or before its arrival", () => {
    const booking = validBooking();
    booking.assignments[0].endDate = "2026-12-01";
    const result = bookingFormSchema.safeParse(booking);
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("assignments.0.endDate");
  });

  it("rejects a gap between split-stay segments", () => {
    const booking = validBooking();
    booking.checkOutDate = "2026-12-06";
    booking.assignments = [
      { ...emptySegment(), roomTypeId: "rt-1", ratePlanId: "rp-1", startDate: "2026-12-01", endDate: "2026-12-03" },
      // Gap: previous segment ends 12-03, this one starts 12-04.
      { ...emptySegment(), roomTypeId: "rt-1", ratePlanId: "rp-2", startDate: "2026-12-04", endDate: "2026-12-06" },
    ];
    const result = bookingFormSchema.safeParse(booking);
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("assignments.1.startDate");
  });

  it("accepts back-to-back split-stay segments", () => {
    const booking = validBooking();
    booking.checkOutDate = "2026-12-05";
    booking.assignments = [
      { ...emptySegment(), roomTypeId: "rt-1", ratePlanId: "rp-1", startDate: "2026-12-01", endDate: "2026-12-03" },
      { ...emptySegment(), roomTypeId: "rt-2", ratePlanId: "rp-1", startDate: "2026-12-03", endDate: "2026-12-05" },
    ];
    expect(bookingFormSchema.safeParse(booking).success).toBe(true);
  });

  it("caps accompanying guests at adults + children - 1", () => {
    const booking = validBooking();
    booking.adults = 2;
    booking.children = 0;
    booking.accompanyingGuestIds = ["g1", "g2"]; // max is 1
    const result = bookingFormSchema.safeParse(booking);
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("accompanyingGuestIds");
  });

  it("rejects a non-numeric or negative override rate but accepts blank", () => {
    const negative = validBooking();
    negative.assignments[0].overrideRate = "-5";
    expect(bookingFormSchema.safeParse(negative).success).toBe(false);

    const junk = validBooking();
    junk.assignments[0].overrideRate = "abc";
    expect(bookingFormSchema.safeParse(junk).success).toBe(false);

    const blank = validBooking();
    blank.assignments[0].overrideRate = "";
    expect(bookingFormSchema.safeParse(blank).success).toBe(true);
  });
});
