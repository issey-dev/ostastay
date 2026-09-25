import { describe, it, expect } from "vitest";
import {
  emptyExcursionBooking,
  emptyPosCharge,
  emptySpaBooking,
  emptySpaParticipantSlot,
  emptyWalkInGuest,
  excursionBookingSchemaFor,
  posChargeSchema,
  spaBookingSchemaFor,
  walkInGuestSchema,
  type SpaParticipantSlot,
  type SpaParticipantValue,
} from "@/lib/sales-form-schemas";

// APP STANDARD 001 schemas behind Fast Post, Excursions and Spa (src/lib/sales-form-schemas.ts).

const paths = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.success ? [] : r.error!.issues.map((i) => i.path.join("."));

describe("Walk-in guest form", () => {
  it("needs a name; contact is optional", () => {
    expect(paths(walkInGuestSchema.safeParse(emptyWalkInGuest))).toEqual(["name"]);
    expect(paths(walkInGuestSchema.safeParse({ name: "   ", contact: "" }))).toEqual(["name"]);
    expect(walkInGuestSchema.safeParse({ name: "Ana", contact: "" }).success).toBe(true);
  });

  it("does not trim or reshape what is sent", () => {
    const r = walkInGuestSchema.parse({ name: " Ana ", contact: "+960 777" });
    expect(r).toEqual({ name: " Ana ", contact: "+960 777" });
  });
});

describe("POS post-charge form", () => {
  const valid = { ...emptyPosCharge, chargeCodeId: "cc1", amount: "12.50" };

  it("accepts a charge and leaves the amount a string", () => {
    const r = posChargeSchema.parse(valid);
    expect(r).toEqual({ chargeCodeId: "cc1", amount: "12.50", description: "", reference: "" });
  });

  it("needs a charge code and a positive amount", () => {
    expect(paths(posChargeSchema.safeParse(emptyPosCharge)).sort()).toEqual(["amount", "chargeCodeId"]);
    expect(paths(posChargeSchema.safeParse({ ...valid, amount: "0" }))).toEqual(["amount"]);
    expect(paths(posChargeSchema.safeParse({ ...valid, amount: "-3" }))).toEqual(["amount"]);
  });
});

describe("Excursion booking form", () => {
  const valid = { ...emptyExcursionBooking, excursionTypeId: "x1", date: "2026-10-01" };

  it("accepts the defaults once an excursion and date are chosen", () => {
    expect(excursionBookingSchemaFor(true).safeParse(valid).success).toBe(true);
    expect(paths(excursionBookingSchemaFor(true).safeParse(emptyExcursionBooking)).sort()).toEqual(["date", "excursionTypeId"]);
  });

  it("counts are blank or whole numbers, and the party is at least one guest", () => {
    const s = excursionBookingSchemaFor(true);
    expect(paths(s.safeParse({ ...valid, childCount: "1.5" }))).toContain("childCount");
    expect(paths(s.safeParse({ ...valid, infantCount: "-1" }))).toContain("infantCount");
    expect(s.safeParse({ ...valid, adultCount: "", childCount: "2" }).success).toBe(true);
    expect(paths(s.safeParse({ ...valid, adultCount: "0", childCount: "0", infantCount: "" }))).toEqual(["adultCount"]);
  });

  it("paying now needs a method in-house, and is ignored for a walk-in", () => {
    const payNow = { ...valid, payment: { settleNow: true, paymentMethodId: "" } };
    expect(paths(excursionBookingSchemaFor(true).safeParse(payNow))).toEqual(["payment"]);
    expect(excursionBookingSchemaFor(false).safeParse(payNow).success).toBe(true);
    expect(excursionBookingSchemaFor(true).safeParse({ ...payNow, payment: { settleNow: true, paymentMethodId: "pm1" } }).success).toBe(true);
  });
});

describe("Spa booking form", () => {
  const guest = { kind: "reservation" as const, reservationId: "r1", guestName: "Ana Silva", roomNumber: "101", profileId: "p1", accompanyingGuests: [] };
  const slot = (value: SpaParticipantValue | null, extra: Partial<SpaParticipantSlot> = {}): SpaParticipantSlot => ({
    ...emptySpaParticipantSlot(),
    value,
    ...extra,
  });
  const valid = { ...emptySpaBooking, treatmentId: "t1", appointmentDate: "2026-10-01", startTime: "10:00", participants: [slot(guest)] };

  it("needs a treatment, date and time", () => {
    expect(spaBookingSchemaFor(true).safeParse(valid).success).toBe(true);
    expect(paths(spaBookingSchemaFor(true).safeParse({ ...emptySpaBooking, participants: [slot(guest)] })).sort()).toEqual([
      "appointmentDate",
      "startTime",
      "treatmentId",
    ]);
  });

  it("party size is a whole number of at least 1", () => {
    expect(paths(spaBookingSchemaFor(true).safeParse({ ...valid, partySize: 0 }))).toContain("partySize");
  });

  it("paying now needs a method in-house, and is ignored for a walk-in", () => {
    const payNow = { ...valid, payment: { settleNow: true, paymentMethodId: "" } };
    expect(paths(spaBookingSchemaFor(true).safeParse(payNow))).toEqual(["payment"]);
    expect(spaBookingSchemaFor(false).safeParse(payNow).success).toBe(true);
  });

  it("starts with one empty slot, and every slot needs a guest", () => {
    expect(emptySpaBooking.participants).toEqual([{ value: null, genderChoice: "ANY", specificTherapistId: "" }]);
    expect(paths(spaBookingSchemaFor(true).safeParse({ ...valid, participants: [slot(null)] }))).toEqual(["participants.0.value"]);
    expect(
      paths(spaBookingSchemaFor(true).safeParse({ ...valid, partySize: 2, participants: [slot(guest), slot(null)] }))
    ).toEqual(["participants.1.value"]);
  });

  it("the slots follow the party size", () => {
    const s = spaBookingSchemaFor(true);
    const companion = slot({ kind: "walkin_companion", guestName: "Ben" });
    expect(s.safeParse({ ...valid, partySize: 2, participants: [slot(guest), companion] }).success).toBe(true);
    expect(paths(s.safeParse({ ...valid, partySize: 2 }))).toEqual(["participants"]);
    expect(paths(s.safeParse({ ...valid, partySize: 1, participants: [slot(guest), companion] }))).toEqual(["participants"]);
  });

  it("accepts every kind of guest, and a gender or a named therapist ask", () => {
    const s = spaBookingSchemaFor(false);
    const walkIn = slot({ kind: "walkin_primary", folioId: "f1", guestName: "Cara" });
    const companion = slot({ kind: "walkin_companion", guestName: "Dev" }, { genderChoice: "FEMALE" });
    const named = slot(guest, { specificTherapistId: "th1" });
    expect(s.safeParse({ ...valid, partySize: 3, participants: [walkIn, companion, named] }).success).toBe(true);
    expect(paths(s.safeParse({ ...valid, participants: [slot(guest, { genderChoice: "OTHER" as never })] }))).toEqual([
      "participants.0.genderChoice",
    ]);
  });

  it("does not reshape a slot (the request body is built from the parsed values)", () => {
    const participants = [
      slot(guest, { specificTherapistId: "th1" }),
      slot({ kind: "walkin_companion", guestName: " Ben " }, { genderChoice: "MALE" }),
    ];
    const r = spaBookingSchemaFor(true).parse({ ...valid, partySize: 2, participants });
    expect(r.participants).toEqual(participants);
  });
});
