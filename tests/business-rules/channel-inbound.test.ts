import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

process.env.SECRETS_ENCRYPTION_KEY = "test-inbound-key";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { prisma } = await import("@/lib/db");
const { parseBeds24Booking, extractBookings, isCancelledStatus } = await import(
  "@/lib/channels/inbound/parse"
);
const { ingestBooking, ingestBookings } = await import("@/lib/channels/inbound/ingest");
const webhookRoute = await import("@/app/api/channels/webhook/[token]/route");

function day(offset: number): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset);
}
function iso(offset: number): string {
  const d = day(offset);
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
}

describe("Inbound bookings", () => {
  // ---------------------------------------------------------------------------
  // Parsing — pure, and the part whose source shape is unverified, so it carries
  // the heaviest testing.
  // ---------------------------------------------------------------------------

  describe("parseBeds24Booking", () => {
    it("reads a well-formed booking", () => {
      const p = parseBeds24Booking({
        id: 998877,
        roomId: 12345,
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        arrival: "2026-09-01",
        departure: "2026-09-04",
        numAdult: 2,
        numChild: 1,
        price: 640.5,
        currency: "USD",
        referer: "Booking.com",
        status: "confirmed",
      });

      // Numeric ids are coerced to strings — Beds24 sends them both ways.
      expect(p.externalBookingId).toBe("998877");
      expect(p.externalRoomId).toBe("12345");
      expect(p.guestFirstName).toBe("Ada");
      expect(p.channelName).toBe("Booking.com");
      expect(p.adults).toBe(2);
      expect(p.totalAmount).toBe(640.5);
      expect(p.problem).toBeNull();
    });

    it("parses dates at LOCAL midnight, not UTC", () => {
      const p = parseBeds24Booking({ id: "1", roomId: "2", arrival: "2026-09-01", departure: "2026-09-02" });
      // new Date("2026-09-01") would be UTC midnight, which in any timezone ahead of UTC is
      // 31 August locally — a guest arriving a day early in the system.
      expect(p.arrival!.getFullYear()).toBe(2026);
      expect(p.arrival!.getMonth()).toBe(8);
      expect(p.arrival!.getDate()).toBe(1);
    });

    it("accepts alternative field spellings", () => {
      // The field names are unverified, so several plausible ones are read. Missing the
      // real one would mean bookings arriving blank.
      const p = parseBeds24Booking({
        bookingId: "B-1",
        roomid: "R-1",
        checkIn: "2026-10-01",
        checkOut: "2026-10-03",
        guestFirstName: "Grace",
        adults: 1,
      });
      expect(p.externalBookingId).toBe("B-1");
      expect(p.externalRoomId).toBe("R-1");
      expect(p.guestFirstName).toBe("Grace");
      expect(p.problem).toBeNull();
    });

    it("reports what is missing instead of throwing", () => {
      const p = parseBeds24Booking({ firstName: "Nobody" });
      expect(p.problem).toContain("no booking id");
      expect(p.problem).toContain("no room id");
      expect(p.problem).toContain("no arrival date");
    });

    it("rejects a stay that does not move forward", () => {
      const p = parseBeds24Booking({ id: "1", roomId: "2", arrival: "2026-09-05", departure: "2026-09-05" });
      expect(p.problem).toContain("departure is not after arrival");
    });

    it("survives a non-object payload", () => {
      expect(parseBeds24Booking(null).problem).toBeTruthy();
      expect(parseBeds24Booking("nonsense").problem).toBeTruthy();
      expect(parseBeds24Booking([1, 2]).problem).toBeTruthy();
    });

    it("extractBookings handles every plausible envelope", () => {
      expect(extractBookings([{ id: 1 }])).toHaveLength(1);
      expect(extractBookings({ data: [{ id: 1 }, { id: 2 }] })).toHaveLength(2);
      expect(extractBookings({ bookings: [{ id: 1 }] })).toHaveLength(1);
      expect(extractBookings({ id: 1 })).toHaveLength(1);
      expect(extractBookings({ unrelated: true })).toHaveLength(0);
      expect(extractBookings(null)).toHaveLength(0);
    });

    it("recognises cancellation words", () => {
      expect(isCancelledStatus("cancelled")).toBe(true);
      expect(isCancelledStatus("CANCELED")).toBe(true);
      expect(isCancelledStatus("confirmed")).toBe(false);
      expect(isCancelledStatus(null)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Ingestion
  // ---------------------------------------------------------------------------

  describe("ingest", () => {
    let enterpriseId: string;
    let connectionId: string;
    let propertyId: string;
    let roomTypeId: string;
    let webhookToken: string;

    beforeAll(async () => {
      const ent = await prisma.enterprise.create({
        data: { name: `In Ent ${Date.now()}`, slug: `test-in-${Date.now()}`, type: "STANDARD" },
      });
      enterpriseId = ent.id;
      await prisma.enterpriseLicense.create({ data: { enterpriseId, tier: "STANDARD", maxProperties: 2 } });

      const property = await prisma.property.create({
        data: {
          enterpriseId,
          name: "Inbound Property",
          code: `IN-${Date.now()}`,
          legalName: "In LLC",
          defaultCurrency: "USD",
          timeZone: "UTC",
          checkInTime: "14:00",
          checkOutTime: "11:00",
        },
      });
      propertyId = property.id;

      webhookToken = `tok-${Date.now()}`;
      const connection = await prisma.channelConnection.create({
        data: {
          enterpriseId,
          provider: "BEDS24",
          name: `In Conn ${Date.now()}`,
          refreshToken: "x",
          webhookToken,
        },
      });
      connectionId = connection.id;

      const link = await prisma.channelPropertyLink.create({
        data: { connectionId, propertyId, externalPropertyId: "ext-in", syncEnabled: true },
      });

      const rt = await prisma.roomType.create({
        data: { propertyId, name: "Standard", code: "STD", maxOccupancy: 2 },
      });
      roomTypeId = rt.id;
      // Exactly ONE sellable room — so a second concurrent booking is an overbooking.
      await prisma.room.create({
        data: { propertyId, roomTypeId: rt.id, roomNumber: "401", status: "AVAILABLE" },
      });
      await prisma.channelRoomTypeMap.create({
        data: { linkId: link.id, roomTypeId: rt.id, externalRoomId: "beds-std", shared: true },
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const booking = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      roomId: "beds-std",
      firstName: "Test",
      lastName: "Guest",
      arrival: iso(30),
      departure: iso(32),
      numAdult: 2,
      price: 300,
      currency: "USD",
      referer: "Booking.com",
      status: "confirmed",
      ...extra,
    });

    it("stores a booking and resolves it to our room type", async () => {
      const r = await ingestBooking({
        enterpriseId,
        connectionId,
        raw: booking("BK-1"),
        source: "WEBHOOK",
      });
      expect(r.status).toBe("CREATED");

      const row = await prisma.channelInboundBooking.findFirst({ where: { externalBookingId: "BK-1" } });
      expect(row!.roomTypeId).toBe(roomTypeId);
      expect(row!.propertyId).toBe(propertyId);
      expect(row!.guestLastName).toBe("Guest");
      expect(row!.problem).toBeNull();
      // The raw body is always kept — it is the only thing guaranteed correct while the
      // source shape is unverified.
      expect(JSON.parse(row!.rawPayload).id).toBe("BK-1");
    });

    it("is IDEMPOTENT — the same booking twice updates, never duplicates", async () => {
      await ingestBooking({ enterpriseId, connectionId, raw: booking("BK-2"), source: "WEBHOOK" });
      const second = await ingestBooking({
        enterpriseId,
        connectionId,
        raw: booking("BK-2", { numAdult: 3 }),
        source: "POLL",
      });

      // Webhook delivery is at-least-once and the poller re-reads overlapping windows, so
      // the same booking WILL arrive repeatedly. A duplicate row is a duplicate guest.
      expect(second.status).toBe("UPDATED");
      expect(await prisma.channelInboundBooking.count({ where: { externalBookingId: "BK-2" } })).toBe(1);

      const row = await prisma.channelInboundBooking.findFirst({ where: { externalBookingId: "BK-2" } });
      // The later delivery wins — a modification must not be ignored just because the id
      // was seen before.
      expect(row!.adults).toBe(3);
      expect(row!.source).toBe("POLL");
    });

    it("keeps a booking for an UNMAPPED room instead of dropping it", async () => {
      const r = await ingestBooking({
        enterpriseId,
        connectionId,
        raw: booking("BK-3", { roomId: "beds-unknown" }),
        source: "WEBHOOK",
      });

      expect(r.status).toBe("CREATED");
      const row = await prisma.channelInboundBooking.findFirst({ where: { externalBookingId: "BK-3" } });
      // A real guest holds this booking. The fix is a mapping change, not a lost reservation.
      expect(row!.roomTypeId).toBeNull();
      expect(row!.problem).toContain("not mapped");
    });

    it("REJECTS a booking with no id — there would be no idempotency key", async () => {
      const before = await prisma.channelInboundBooking.count({ where: { enterpriseId } });
      const r = await ingestBooking({
        enterpriseId,
        connectionId,
        raw: { roomId: "beds-std", arrival: iso(1), departure: iso(2) },
        source: "WEBHOOK",
      });

      expect(r.status).toBe("REJECTED");
      // Storing it would risk a duplicate on the next delivery, since nothing identifies it.
      expect(await prisma.channelInboundBooking.count({ where: { enterpriseId } })).toBe(before);
    });

    it("FLAGS an overbooking but still accepts the booking", async () => {
      // One room, and two overlapping bookings for it.
      await prisma.reservation.create({
        data: {
          confirmationNo: `INB-${Date.now()}`,
          propertyId,
          primaryGuestId: (
            await prisma.profile.create({
              data: { enterpriseId, profileType: "GUEST", firstName: "Sitting", lastName: "Guest" },
            })
          ).upid,
          checkInDate: day(50),
          checkOutDate: day(52),
          status: "RESERVED",
          adults: 1,
          assignments: {
            create: {
              roomTypeId,
              ratePlanId: (
                await prisma.ratePlan.create({ data: { propertyId, code: `R${Date.now()}`, name: "R" } })
              ).id,
              startDate: day(50),
              endDate: day(52),
            },
          },
        },
      });

      const r = await ingestBooking({
        enterpriseId,
        connectionId,
        raw: booking("BK-OVER", { arrival: iso(50), departure: iso(52) }),
        source: "WEBHOOK",
      });

      // D-7 rule 4: the channel already confirmed this to the guest, so refusing is not
      // genuinely available to us. Accept and flag — the desk must find out days ahead
      // rather than at the door.
      expect(r.status).toBe("CREATED");
      expect(r.isOverbooking).toBe(true);

      const row = await prisma.channelInboundBooking.findFirst({ where: { externalBookingId: "BK-OVER" } });
      expect(row!.isOverbooking).toBe(true);
      expect(row!.overbookingNote).toBeTruthy();
    });

    it("does NOT flag a cancellation as an overbooking", async () => {
      const r = await ingestBooking({
        enterpriseId,
        connectionId,
        raw: booking("BK-CANCEL", { arrival: iso(50), departure: iso(52), status: "cancelled" }),
        source: "WEBHOOK",
      });
      // A cancellation releases inventory; it cannot possibly oversell it.
      expect(r.isOverbooking).toBe(false);
    });

    it("re-flagging clears a previous acknowledgement", async () => {
      const row = await prisma.channelInboundBooking.findFirst({ where: { externalBookingId: "BK-OVER" } });
      await prisma.channelInboundBooking.update({
        where: { id: row!.id },
        data: { acknowledgedAt: new Date(), acknowledgedById: "someone" },
      });

      await ingestBooking({
        enterpriseId,
        connectionId,
        raw: booking("BK-OVER", { arrival: iso(50), departure: iso(52), numAdult: 4 }),
        source: "WEBHOOK",
      });

      const after = await prisma.channelInboundBooking.findFirst({ where: { externalBookingId: "BK-OVER" } });
      // Acknowledging a specific state must not silence a later modification that is still
      // overbooking — it would drop out of the desk's view while still being a problem.
      expect(after!.acknowledgedAt).toBeNull();
    });

    it("one bad booking in a batch does not drop the others", async () => {
      const results = await ingestBookings({
        enterpriseId,
        connectionId,
        bookings: [booking("BK-A"), "not-an-object", booking("BK-B")],
        source: "POLL",
      });

      expect(results.filter((r) => r.status === "CREATED")).toHaveLength(2);
      expect(results.filter((r) => r.status === "REJECTED")).toHaveLength(1);
    });

    // -------------------------------------------------------------------------
    // Webhook authentication
    // -------------------------------------------------------------------------

    it("the webhook rejects a wrong token with a bare 404", async () => {
      const res = await webhookRoute.POST(
        new Request("http://localhost", { method: "POST", body: JSON.stringify([booking("BK-X")]) }),
        { params: Promise.resolve({ token: "wrong-token" }) }
      );
      // 404 and nothing else — a webhook URL is a credential, so a distinguishable response
      // would let it be probed.
      expect(res.status).toBe(404);
      expect(await prisma.channelInboundBooking.count({ where: { externalBookingId: "BK-X" } })).toBe(0);
    });

    it("the webhook accepts a valid token and stores the booking", async () => {
      const res = await webhookRoute.POST(
        new Request("http://localhost", { method: "POST", body: JSON.stringify([booking("BK-HOOK")]) }),
        { params: Promise.resolve({ token: webhookToken }) }
      );
      expect(res.status).toBe(200);
      expect(await prisma.channelInboundBooking.count({ where: { externalBookingId: "BK-HOOK" } })).toBe(1);
    });

    it("the webhook writes an INBOUND log entry", async () => {
      await webhookRoute.POST(
        new Request("http://localhost", { method: "POST", body: JSON.stringify([booking("BK-LOG")]) }),
        { params: Promise.resolve({ token: webhookToken }) }
      );

      const log = await prisma.channelSyncLog.findFirst({
        where: { enterpriseId, direction: "INBOUND" },
        orderBy: { createdAt: "desc" },
      });
      // Until now nothing wrote INBOUND — the Exchange Log's inbound filter could never
      // match anything.
      expect(log).toBeTruthy();
      expect(log!.operation).toBe("booking.webhook");
    });

    it("the webhook returns 200 for an unparseable body rather than inviting retries", async () => {
      const res = await webhookRoute.POST(
        new Request("http://localhost", { method: "POST", body: "{{{not json" }),
        { params: Promise.resolve({ token: webhookToken }) }
      );
      // A non-2xx makes the channel retry, and retrying cannot fix a malformed payload —
      // it would redeliver forever while the real problem stays invisible.
      expect(res.status).toBe(200);
    });
  });
});
