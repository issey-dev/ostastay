import { describe, it, expect, beforeAll } from "vitest";

const { prisma } = await import("@/lib/db");
const { setBookingDefaults } = await import("@/lib/channels/defaults");
const { convertInboundBooking, convertEligibleBookings } = await import("@/lib/channels/inbound/convert");

function day(offset: number): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset);
}

describe("Inbound booking conversion", () => {
  let enterpriseId: string;
  let connectionId: string;
  let propertyId: string;
  let roomTypeId: string;
  let ratePlanId: string;
  let linkId: string;

  beforeAll(async () => {
    const ent = await prisma.enterprise.create({
      data: { name: `Conv Ent ${Date.now()}`, slug: `test-conv-${Date.now()}`, type: "STANDARD" },
    });
    enterpriseId = ent.id;
    await prisma.enterpriseLicense.create({ data: { enterpriseId, tier: "STANDARD", maxProperties: 2 } });

    const property = await prisma.property.create({
      data: {
        enterpriseId,
        name: "Convert Property",
        code: `CV-${Date.now()}`,
        legalName: "Convert LLC",
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });
    propertyId = property.id;

    const connection = await prisma.channelConnection.create({
      data: { enterpriseId, provider: "BEDS24", name: `Conv Conn ${Date.now()}`, refreshToken: "x" },
    });
    connectionId = connection.id;

    const link = await prisma.channelPropertyLink.create({
      data: { connectionId, propertyId, externalPropertyId: "ext-conv", syncEnabled: true },
    });
    linkId = link.id;

    const rt = await prisma.roomType.create({
      data: { propertyId, name: "Standard", code: "STD", maxOccupancy: 2 },
    });
    roomTypeId = rt.id;
    await prisma.room.create({ data: { propertyId, roomTypeId, roomNumber: "101", status: "AVAILABLE" } });

    const rp = await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "Best Available" } });
    ratePlanId = rp.id;
  });

  function makeBooking(
    externalBookingId: string,
    extra: {
      roomTypeId?: string | null;
      propertyId?: string | null;
      guestEmail?: string;
      arrival?: Date;
      departure?: Date;
      channelStatus?: string;
    } = {}
  ) {
    return prisma.channelInboundBooking.create({
      data: {
        enterpriseId,
        connectionId,
        externalBookingId,
        channelName: "Booking.com",
        source: "WEBHOOK",
        externalRoomId: "beds-std",
        roomTypeId,
        propertyId,
        guestFirstName: "Ada",
        guestLastName: "Lovelace",
        guestEmail: `ada-${externalBookingId}@example.com`,
        arrival: day(30),
        departure: day(32),
        adults: 2,
        children: 0,
        totalAmount: 300,
        currency: "USD",
        channelStatus: "confirmed",
        rawPayload: "{}",
        ...extra,
      },
    });
  }

  it("refuses to convert without a configured default rate plan, staying RECEIVED for retry", async () => {
    const booking = await makeBooking("no-default-1");
    const result = await convertInboundBooking(booking.id);

    expect(result.status).toBe("PENDING");
    expect(result.reason).toContain("No default rate plan");

    const stored = await prisma.channelInboundBooking.findUnique({ where: { id: booking.id } });
    expect(stored?.status).toBe("RECEIVED");
    expect(stored?.problem).toContain("No default rate plan");
  });

  it("converts an eligible booking into a real Reservation once defaults are configured", async () => {
    await setBookingDefaults({ enterpriseId, linkId, ratePlanId, mealPlanCode: "BB" });

    const booking = await makeBooking("ok-1");
    const result = await convertInboundBooking(booking.id);

    expect(result.status).toBe("CONVERTED");
    expect(result.reservationId).toBeTruthy();

    const reservation = await prisma.reservation.findUnique({
      where: { id: result.reservationId! },
      include: { primaryGuest: true, assignments: true },
    });
    expect(reservation).toBeTruthy();
    expect(reservation!.propertyId).toBe(propertyId);
    expect(reservation!.mealPlan).toBe("BB");
    expect(reservation!.assignments[0].roomTypeId).toBe(roomTypeId);
    expect(reservation!.assignments[0].ratePlanId).toBe(ratePlanId);
    expect(reservation!.primaryGuest.firstName).toBe("Ada");
    expect(reservation!.remarks).toContain("ok-1");

    const stored = await prisma.channelInboundBooking.findUnique({ where: { id: booking.id } });
    expect(stored?.status).toBe("CONVERTED");
    expect(stored?.reservationId).toBe(result.reservationId);
  });

  it("reuses an existing guest profile found by email rather than creating a duplicate", async () => {
    await setBookingDefaults({ enterpriseId, linkId, ratePlanId, mealPlanCode: "NONE" });

    const first = await makeBooking("reuse-1", { guestEmail: "shared@example.com" });
    const r1 = await convertInboundBooking(first.id);
    const res1 = await prisma.reservation.findUnique({ where: { id: r1.reservationId! } });

    const second = await makeBooking("reuse-2", {
      guestEmail: "shared@example.com",
      arrival: day(40),
      departure: day(42),
    });
    const r2 = await convertInboundBooking(second.id);
    const res2 = await prisma.reservation.findUnique({ where: { id: r2.reservationId! } });

    expect(res2!.primaryGuestId).toBe(res1!.primaryGuestId);
  });

  it("is idempotent — converting an already-converted booking is a no-op", async () => {
    await setBookingDefaults({ enterpriseId, linkId, ratePlanId, mealPlanCode: "NONE" });
    const booking = await makeBooking("idempotent-1");

    const first = await convertInboundBooking(booking.id);
    expect(first.status).toBe("CONVERTED");
    const countAfterFirst = await prisma.reservation.count();

    const second = await convertInboundBooking(booking.id);
    expect(second.status).toBe("SKIPPED");

    // No second Reservation was created, and the booking still points at the original one.
    expect(await prisma.reservation.count()).toBe(countAfterFirst);
    const stored = await prisma.channelInboundBooking.findUnique({ where: { id: booking.id } });
    expect(stored?.reservationId).toBe(first.reservationId);
  });

  it("ignores a cancelled booking rather than converting it", async () => {
    const booking = await makeBooking("cancelled-1", { channelStatus: "cancelled" });
    const result = await convertInboundBooking(booking.id);

    expect(result.status).toBe("SKIPPED");
    expect(result.reason).toContain("cancelled");

    const stored = await prisma.channelInboundBooking.findUnique({ where: { id: booking.id } });
    expect(stored?.status).toBe("IGNORED");
    expect(stored?.reservationId).toBeNull();
  });

  it("D-7 rule 4: an inbound booking that exceeds availability is still converted, not refused", async () => {
    await setBookingDefaults({ enterpriseId, linkId, ratePlanId, mealPlanCode: "NONE" });

    // Only one physical room of this type exists (from beforeAll); book it out first with an
    // ordinary reservation covering the same window, so the channel booking is a genuine
    // overbook.
    const guest = await prisma.profile.create({
      data: { enterpriseId, profileType: "GUEST", firstName: "Existing" },
    });
    await prisma.reservation.create({
      data: {
        confirmationNo: `CV-BLOCK-${Date.now()}`,
        propertyId,
        primaryGuestId: guest.upid,
        checkInDate: day(50),
        checkOutDate: day(52),
        status: "RESERVED",
        assignments: { create: [{ roomTypeId, ratePlanId, startDate: day(50), endDate: day(52) }] },
        folios: { create: { folioNumber: 1, propertyId } },
      },
    });

    const booking = await makeBooking("overbook-1", { arrival: day(50), departure: day(52) });
    const result = await convertInboundBooking(booking.id);

    // Accepted and flagged, never refused — the channel already confirmed it to the guest.
    expect(result.status).toBe("CONVERTED");
    expect(result.reservationId).toBeTruthy();
  });

  it("convertEligibleBookings sweeps every RECEIVED, mapped booking for the enterprise", async () => {
    await setBookingDefaults({ enterpriseId, linkId, ratePlanId, mealPlanCode: "NONE" });

    const eligible = await makeBooking("sweep-eligible", { arrival: day(60), departure: day(61) });
    // Unmapped — no room type resolved — must be left alone by the sweep.
    const unmapped = await makeBooking("sweep-unmapped", { roomTypeId: null, propertyId: null, arrival: day(62), departure: day(63) });

    const results = await convertEligibleBookings(enterpriseId);
    const forEligible = results.find((r) => r.bookingId === eligible.id);
    expect(forEligible?.status).toBe("CONVERTED");
    expect(results.some((r) => r.bookingId === unmapped.id)).toBe(false);

    const stillReceived = await prisma.channelInboundBooking.findUnique({ where: { id: unmapped.id } });
    expect(stillReceived?.status).toBe("RECEIVED");
  });
});
