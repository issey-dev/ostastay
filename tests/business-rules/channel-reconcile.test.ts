import { describe, it, expect, beforeAll, vi } from "vitest";

process.env.SECRETS_ENCRYPTION_KEY = "test-channel-reconcile-key";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

// The property in this test has no staff, so notify() would correctly find no recipients and
// write nothing. What matters here is that the rule RAISES the notification; recipients and
// delivery are covered by the notifications suites.
const spies = vi.hoisted(() => ({ cancelled: vi.fn(), review: vi.fn() }));
vi.mock("@/lib/notifications/producers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/producers")>()),
  notifyChannelBookingCancelled: spies.cancelled,
  notifyChannelBookingReview: spies.review,
}));

const { prisma } = await import("@/lib/db");
const { setBookingDefaults } = await import("@/lib/channels/defaults");
const { ingestBooking } = await import("@/lib/channels/inbound/ingest");
const { convertInboundBooking } = await import("@/lib/channels/inbound/convert");
const { clearResolvedPending } = await import("@/lib/channels/inbound/reconcile");
const { parseBeds24Booking, isCancelledStatus } = await import("@/lib/channels/inbound/parse");
const { computeChannelAvailability } = await import("@/lib/channels/sync");
const { formatLocalDay } = await import("@/lib/availability");
const { connectProperty, makeChannelProperty } = await import("../helpers/channel");
const { chargeCode } = await import("../helpers/charge-codes");

// DECISIONS.md "Channel bookings changed or cancelled after they became a reservation"
// (2026-11-23): a channel cancellation is applied automatically only when safe; otherwise, and
// for every change, it is flagged for the desk.

function day(offset: number): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset);
}
const ymd = (d: Date) => formatLocalDay(d.getTime());

describe("Channel cancellations and changes after conversion", () => {
  let enterpriseId: string;
  let propertyId: string;
  let connectionId: string;
  let linkId: string;
  let stdTypeId: string;
  let supTypeId: string;
  let staffUserId: string;

  beforeAll(async () => {
    const ent = await prisma.enterprise.create({
      data: { name: `Recon Ent ${Date.now()}`, slug: `test-recon-${Date.now()}`, type: "STANDARD" },
    });
    enterpriseId = ent.id;
    await prisma.enterpriseLicense.create({ data: { enterpriseId, tier: "STANDARD", maxProperties: 2 } });
    propertyId = (await makeChannelProperty(enterpriseId, "Recon Property")).id;
    const c = await connectProperty(propertyId, { syncEnabled: false });
    connectionId = c.connection.id;
    linkId = c.link.id;

    stdTypeId = (await prisma.roomType.create({ data: { propertyId, name: "Standard", code: "STD", maxOccupancy: 3 } })).id;
    supTypeId = (await prisma.roomType.create({ data: { propertyId, name: "Superior", code: "SUP", maxOccupancy: 3 } })).id;
    for (let i = 1; i <= 3; i++) {
      await prisma.room.create({ data: { propertyId, roomTypeId: stdTypeId, roomNumber: `30${i}`, status: "AVAILABLE" } });
      await prisma.room.create({ data: { propertyId, roomTypeId: supTypeId, roomNumber: `40${i}`, status: "AVAILABLE" } });
    }
    await prisma.channelRoomTypeMap.create({ data: { linkId, roomTypeId: stdTypeId, externalRoomId: "11", shared: true } });
    await prisma.channelRoomTypeMap.create({ data: { linkId, roomTypeId: supTypeId, externalRoomId: "12", shared: true } });
    const ratePlanId = (await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "Best Available" } })).id;
    await setBookingDefaults({ enterpriseId, linkId, ratePlanId, mealPlanCode: "NONE" });

    staffUserId = (await prisma.user.create({
      data: { email: `recon-${Date.now()}@example.com`, firstName: "Desk", lastName: "Staff", passwordHash: "x", enterpriseId },
    })).id;
  });

  type Raw = { arrival?: Date; departure?: Date; status?: string; roomId?: number; numAdult?: number };
  async function deliver(id: string, raw: Raw = {}) {
    return ingestBooking({
      enterpriseId,
      connectionId,
      source: "WEBHOOK",
      parse: parseBeds24Booking,
      isCancelled: isCancelledStatus,
      raw: {
        id,
        roomId: raw.roomId ?? 11,
        arrival: ymd(raw.arrival ?? day(20)),
        departure: ymd(raw.departure ?? day(22)),
        status: raw.status ?? "confirmed",
        numAdult: raw.numAdult ?? 2,
        numChild: 0,
        firstName: "Recon",
        lastName: `Guest ${id}`,
        referer: "Booking.com",
      },
    });
  }

  /** Deliver, convert, and return the inbound row id and reservation id. */
  async function converted(id: string, raw: Raw = {}) {
    await deliver(id, raw);
    const row = await prisma.channelInboundBooking.findUniqueOrThrow({
      where: { connectionId_externalBookingId: { connectionId, externalBookingId: id } },
    });
    const res = await convertInboundBooking(row.id);
    expect(res.status).toBe("CONVERTED");
    return { inboundId: row.id, reservationId: res.reservationId! };
  }

  const reservation = (id: string) => prisma.reservation.findUniqueOrThrow({ where: { id } });
  const inbound = (id: string) => prisma.channelInboundBooking.findUniqueOrThrow({ where: { id } });

  it("a SAFE cancellation cancels the reservation automatically and closes its folios", async () => {
    const { inboundId, reservationId } = await converted("safe-1");
    await deliver("safe-1", { status: "cancelled" });

    const r = await reservation(reservationId);
    expect(r.status).toBe("CANCELLED");
    expect(r.cancellationReasonCode).toBe("CHANNEL_CANCELLED");
    expect(r.cancellationReason).toBe("Cancelled at Booking.com");
    expect(await prisma.folio.count({ where: { reservationId, isClosed: false } })).toBe(0);
    expect((await inbound(inboundId)).pendingAction).toBeNull();
    // A notification tells the desk it happened.
    expect(spies.cancelled).toHaveBeenCalledWith(expect.objectContaining({ reservationId, channelName: "Booking.com" }));
  });

  it("a guest already checked in: the cancellation is flagged, never applied", async () => {
    const { inboundId, reservationId } = await converted("inhouse-1");
    await prisma.reservation.update({ where: { id: reservationId }, data: { status: "IN_HOUSE" } });
    await deliver("inhouse-1", { status: "cancelled" });

    expect((await reservation(reservationId)).status).toBe("IN_HOUSE");
    const row = await inbound(inboundId);
    expect(row.pendingAction).toBe("CANCEL");
    expect(row.pendingReason).toContain("checked in");
    expect(spies.review).toHaveBeenCalledWith(expect.objectContaining({ reservationId, action: "CANCEL" }));
  });

  it("a charge on the folio: flagged", async () => {
    const { inboundId, reservationId } = await converted("folio-1");
    const folio = await prisma.folio.findFirstOrThrow({ where: { reservationId } });
    const code = await chargeCode({ propertyId }, "1000");
    await prisma.folioLineItem.create({
      data: { folioId: folio.id, chargeCodeId: code.id, date: new Date(), description: "Minibar", amount: 10 },
    });
    await deliver("folio-1", { status: "cancelled" });

    expect((await reservation(reservationId)).status).not.toBe("CANCELLED");
    expect((await inbound(inboundId)).pendingReason).toContain("folio");
  });

  it("staff edited the reservation since it arrived: flagged", async () => {
    const { inboundId, reservationId } = await converted("edited-1");
    await prisma.userActivityLog.create({
      data: {
        enterpriseId, userId: staffUserId, module: "RESERVATIONS", action: "UPDATE",
        entityType: "Reservation", entityId: reservationId, description: "edited",
        createdAt: new Date(Date.now() + 1000),
      },
    });
    await deliver("edited-1", { status: "cancelled" });

    expect((await reservation(reservationId)).status).not.toBe("CANCELLED");
    expect((await inbound(inboundId)).pendingReason).toContain("staff");
  });

  it("a linked Transfer booking: flagged", async () => {
    const { inboundId, reservationId } = await converted("transfer-1");
    await prisma.reservationTransport.create({ data: { reservationId, direction: "PICKUP" } });
    await deliver("transfer-1", { status: "cancelled" });

    expect((await reservation(reservationId)).status).not.toBe("CANCELLED");
    expect((await inbound(inboundId)).pendingReason).toContain("Transfer");
  });

  it("once the desk cancels a flagged booking itself, the flag clears", async () => {
    const { inboundId, reservationId } = await converted("deskcancel-1");
    await prisma.reservationTransport.create({ data: { reservationId, direction: "PICKUP" } });
    await deliver("deskcancel-1", { status: "cancelled" });
    expect((await inbound(inboundId)).pendingAction).toBe("CANCEL");

    await prisma.reservation.update({ where: { id: reservationId }, data: { status: "CANCELLED" } });
    expect(await clearResolvedPending(inboundId)).toBe(true);
    expect((await inbound(inboundId)).pendingAction).toBeNull();
  });

  it("a date change is ALWAYS flagged, never applied, even when cancelling would have been safe", async () => {
    const { inboundId, reservationId } = await converted("change-1", { arrival: day(40), departure: day(42) });
    await deliver("change-1", { arrival: day(41), departure: day(44) });

    const r = await reservation(reservationId);
    expect(ymd(r.checkInDate)).toBe(ymd(day(40)));
    expect(ymd(r.checkOutDate)).toBe(ymd(day(42)));
    const row = await inbound(inboundId);
    expect(row.pendingAction).toBe("CHANGE");
    expect(row.pendingReason).toContain(`became ${ymd(day(41))} → ${ymd(day(44))}`);
  });

  it("while a change waits, the channel's NEW nights are held in what is published (no double count of the overlap)", async () => {
    const plan = await computeChannelAvailability({ enterpriseId, linkId, from: day(40), to: day(44) });
    const std = new Map(plan.roomTypes.find((t) => t.roomTypeId === stdTypeId)!.nights.map((n) => [n.date, n.available]));
    // Reservation holds 40 and 41; the pending change adds 42 and 43; 41 is held once, not twice.
    expect(std.get(ymd(day(40)))).toBe(2);
    expect(std.get(ymd(day(41)))).toBe(2);
    expect(std.get(ymd(day(42)))).toBe(2);
    expect(std.get(ymd(day(43)))).toBe(2);
  });

  it("once the desk applies the change, the flag clears", async () => {
    const row = await prisma.channelInboundBooking.findUniqueOrThrow({
      where: { connectionId_externalBookingId: { connectionId, externalBookingId: "change-1" } },
    });
    // The edit form saves dates as UTC midnight; the comparison must still see them as equal.
    const utc = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    await prisma.reservation.update({ where: { id: row.reservationId! }, data: { checkInDate: utc(day(41)), checkOutDate: utc(day(44)) } });
    expect(await clearResolvedPending(row.id)).toBe(true);
    expect((await inbound(row.id)).pendingAction).toBeNull();
  });

  it("a room type or guest-count change is flagged with what changed", async () => {
    const { inboundId } = await converted("change-2", { arrival: day(50), departure: day(51) });
    await deliver("change-2", { arrival: day(50), departure: day(51), roomId: 12, numAdult: 3 });
    const row = await inbound(inboundId);
    expect(row.pendingAction).toBe("CHANGE");
    expect(row.pendingReason).toContain("room type Standard became Superior");
    expect(row.pendingReason).toContain("adults 2 became 3");
  });

  it("re-delivering the same change does not raise another notification", async () => {
    const before = spies.review.mock.calls.length;
    await deliver("change-2", { arrival: day(50), departure: day(51), roomId: 12, numAdult: 3 });
    expect(spies.review.mock.calls.length).toBe(before);
  });
});
