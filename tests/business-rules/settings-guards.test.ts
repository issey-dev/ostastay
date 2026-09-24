import { describe, it, expect, beforeAll, vi } from "vitest";

// Guards added to Hub setup screens (2026-09-24): the Sequence Manager's floor, property
// amenity names, therapist availability exceptions (EXTENDED_HOURS), spa settings, and
// the website's "booking on needs a rate plan" rule.

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { prisma } = await import("@/lib/db");
const { highestIssuedNumber, assertSequenceChangeAllowed, SequenceGuardError } = await import("@/lib/sequence-guard");
const { amenitySchema } = await import("@/lib/facility-amenity");
const { amenityNameTaken } = await import("@/lib/facility-amenity-db");
const { therapistExceptionSchema } = await import("@/lib/spa-exception");
const { getAvailableTherapists } = await import("@/lib/spa-availability");
const { updateWebsitePropertySettings } = await import("@/lib/website-api/settings");
const { chargeCode } = await import("../helpers/charge-codes");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("Hub setup guards", () => {
  let enterpriseId: string;
  let propertyId: string;
  let propertyCode: string;
  let guestId: string;

  beforeAll(async () => {
    const enterprise = await prisma.enterprise.create({ data: { name: "Guards", slug: `test-guards-${uniq()}`, type: "STANDARD" } });
    enterpriseId = enterprise.id;
    propertyCode = `GD${uniq().slice(-6)}`.toUpperCase();
    const property = await prisma.property.create({
      data: {
        enterpriseId, name: "Guards Prop", code: propertyCode, legalName: "Guards LLC", defaultCurrency: "USD",
        timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", businessDate: new Date(Date.UTC(new Date().getUTCFullYear(), 5, 15)),
      },
    });
    propertyId = property.id;
    guestId = (await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "Gua", lastName: "Rd" } })).upid;
  });

  describe("Sequence Manager floor", () => {
    it("reads the highest issued tax invoice / proforma number from the folios themselves", async () => {
      expect(await highestIssuedNumber(propertyId, "TAX_INVOICE")).toBe(0);
      await prisma.folio.create({ data: { propertyId, taxInvoiceNumber: "INV-00012", proformaInvoiceNumber: "PRO-00003" } });
      await prisma.folio.create({ data: { propertyId, taxInvoiceNumber: "INV-00007" } });
      // Not the app's format — can't be tied to the counter, so ignored.
      await prisma.folio.create({ data: { propertyId, taxInvoiceNumber: "MANUAL-99" } });
      expect(await highestIssuedNumber(propertyId, "TAX_INVOICE")).toBe(12);
      expect(await highestIssuedNumber(propertyId, "PROFORMA_FOLIO")).toBe(3);
    });

    it("refuses a counter below the highest issued number, allows it at or above", async () => {
      await expect(assertSequenceChangeAllowed(propertyId, "TAX_INVOICE", 11)).rejects.toBeInstanceOf(SequenceGuardError);
      await expect(assertSequenceChangeAllowed(propertyId, "TAX_INVOICE", 11)).rejects.toThrow(/highest tax invoice number already issued is 12/);
      await expect(assertSequenceChangeAllowed(propertyId, "TAX_INVOICE", 12)).resolves.toBeUndefined();
      await expect(assertSequenceChangeAllowed(propertyId, "TAX_INVOICE", 500)).resolves.toBeUndefined();
      // Nothing issued yet: any value is fine.
      await expect(assertSequenceChangeAllowed(propertyId, "RECEIPT_NO", 0)).resolves.toBeUndefined();
    });

    it("reads booking numbers under the property's current prefix only", async () => {
      const mk = (confirmationNo: string) =>
        prisma.reservation.create({
          data: {
            propertyId, confirmationNo, primaryGuestId: guestId, status: "CONFIRMED", adults: 1,
            checkInDate: new Date(Date.UTC(2030, 0, 1)), checkOutDate: new Date(Date.UTC(2030, 0, 2)),
          },
        });
      await mk(`${propertyCode}-000041`);
      await mk(`${propertyCode}-000009`);
      await mk(`OLD-${uniq()}`); // an old random-style number
      expect(await highestIssuedNumber(propertyId, "REGISTRATION_NO")).toBe(41);
      await expect(assertSequenceChangeAllowed(propertyId, "REGISTRATION_NO", 40)).rejects.toThrow(/41/);
      await expect(assertSequenceChangeAllowed(propertyId, "REGISTRATION_NO", 41)).resolves.toBeUndefined();
    });

    it("locks the Green Tax counter once the register has numbers this year", async () => {
      await expect(assertSequenceChangeAllowed(propertyId, "GUEST_REG_NO", 5)).resolves.toBeUndefined();
      const res = await prisma.reservation.findFirstOrThrow({ where: { propertyId } });
      await prisma.guestRegistration.create({
        data: {
          propertyId, reservationId: res.id, profileId: guestId, registrationNo: 1,
          year: new Date().getUTCFullYear(), isPrimary: true, businessDate: new Date(),
        },
      });
      await expect(assertSequenceChangeAllowed(propertyId, "GUEST_REG_NO", 5)).rejects.toThrow(/Green Tax register/);
    });
  });

  describe("Property amenities", () => {
    it("validates the name and trims an empty description away", () => {
      expect(amenitySchema.safeParse({ name: "   " }).success).toBe(false);
      expect(amenitySchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
      const ok = amenitySchema.parse({ name: "  Infinity Pool ", description: "  " });
      expect(ok.name).toBe("Infinity Pool");
      expect(ok.description).toBe("");
    });

    it("treats names case- and space-insensitively as duplicates, excluding the row being edited", async () => {
      const pool = await prisma.facility.create({ data: { propertyId, name: "Infinity Pool" } });
      expect(await amenityNameTaken(propertyId, "infinity  pool")).toBe(true);
      expect(await amenityNameTaken(propertyId, "Infinity Pool", pool.id)).toBe(false);
      expect(await amenityNameTaken(propertyId, "Gym")).toBe(false);
    });
  });

  describe("Therapist exceptions", () => {
    it("requires both times for EXTENDED_HOURS, and a start before the end", () => {
      const base = { date: "2030-03-04", reason: "" };
      expect(therapistExceptionSchema.safeParse({ ...base, exceptionType: "EXTENDED_HOURS" }).success).toBe(false);
      expect(therapistExceptionSchema.safeParse({ ...base, exceptionType: "EXTENDED_HOURS", startTime: "18:00", endTime: "17:00" }).success).toBe(false);
      expect(therapistExceptionSchema.safeParse({ ...base, exceptionType: "EXTENDED_HOURS", startTime: "07:00", endTime: "21:00" }).success).toBe(true);
      // Other types: whole day (no times) or both times — never just one.
      expect(therapistExceptionSchema.safeParse({ ...base, exceptionType: "DAY_OFF" }).success).toBe(true);
      expect(therapistExceptionSchema.safeParse({ ...base, exceptionType: "TRAINING", startTime: "10:00" }).success).toBe(false);
    });

    it("an EXTENDED_HOURS exception makes a therapist bookable outside their weekly schedule", async () => {
      const cc = await chargeCode({ propertyId }, "8500").catch(async () => (await prisma.chargeCode.findFirstOrThrow({ where: { propertyId } })));
      const category = await prisma.spaTreatmentCategory.create({ data: { propertyId, name: `Massage ${uniq()}` } });
      const treatment = await prisma.spaTreatment.create({
        data: { propertyId, categoryId: category.id, name: "Swedish", defaultDurationMinutes: 60, chargeCodeId: cc.id },
      });
      const therapist = await prisma.spaTherapist.create({ data: { propertyId, displayName: "Ext" } });
      await prisma.spaTherapistTreatment.create({ data: { therapistId: therapist.id, treatmentId: treatment.id } });
      const date = new Date(Date.UTC(2030, 2, 4));
      // Works 09:00-12:00 on that weekday.
      await prisma.spaTherapistSchedule.create({
        data: { therapistId: therapist.id, dayOfWeek: date.getUTCDay(), startTime: "09:00", endTime: "12:00", effectiveFrom: new Date(Date.UTC(2020, 0, 1)) },
      });
      const at = (from: string, until: string) =>
        getAvailableTherapists({ propertyId, treatmentId: treatment.id, date, blockedFromTime: from, blockedUntilTime: until });

      expect((await at("15:00", "16:00")).map((t) => t.id)).toEqual([]);
      await prisma.spaTherapistAvailabilityException.create({
        data: { therapistId: therapist.id, date, exceptionType: "EXTENDED_HOURS", startTime: "09:00", endTime: "18:00" },
      });
      expect((await at("15:00", "16:00")).map((t) => t.id)).toEqual([therapist.id]);
      // Only within the extended window.
      expect((await at("17:30", "18:30")).map((t) => t.id)).toEqual([]);
    });
  });

  describe("Website: booking on needs a rate plan", () => {
    it("refuses booking on without a plan, accepts it once a plan is set or booking is off", async () => {
      const plan = await prisma.ratePlan.create({ data: { propertyId, code: `WEB${uniq().slice(-4)}`, name: "Web" } });
      await expect(
        updateWebsitePropertySettings({ enterpriseId, propertyId, input: { bookingEnabled: true, ratePlanId: null } })
      ).rejects.toThrow(/rate plan/);
      // No row yet reads as booking on — naming only the switch still needs a plan.
      await expect(
        updateWebsitePropertySettings({ enterpriseId, propertyId, input: { bookingEnabled: true } })
      ).rejects.toThrow(/rate plan/);
      await expect(
        updateWebsitePropertySettings({ enterpriseId, propertyId, input: { bookingEnabled: false, ratePlanId: null } })
      ).resolves.toMatchObject({ bookingEnabled: false });
      // An unrelated edit is never refused because of the stored state.
      await expect(
        updateWebsitePropertySettings({ enterpriseId, propertyId, input: { headline: "Hello" } })
      ).resolves.toMatchObject({ headline: "Hello" });
      await expect(
        updateWebsitePropertySettings({ enterpriseId, propertyId, input: { bookingEnabled: true, ratePlanId: plan.id } })
      ).resolves.toMatchObject({ bookingEnabled: true, ratePlanId: plan.id });
    });
  });
});
