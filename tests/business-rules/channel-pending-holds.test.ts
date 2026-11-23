import { describe, it, expect, beforeAll, vi } from "vitest";

process.env.SECRETS_ENCRYPTION_KEY = "test-channel-pending-key";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { prisma } = await import("@/lib/db");
const { computeChannelAvailability } = await import("@/lib/channels/sync");
const { perNightTypeAvailability, formatLocalDay } = await import("@/lib/availability");
const { ingestBooking } = await import("@/lib/channels/inbound/ingest");
const { parseBeds24Booking, isCancelledStatus } = await import("@/lib/channels/inbound/parse");
const { connectProperty, makeChannelProperty } = await import("../helpers/channel");

// Channel Providers plan, Phase 0 gap 1: a channel booking received but not yet converted
// into a reservation must still hold its room in what we PUBLISH — pushes are absolute counts,
// so otherwise the next push re-opens the room it already sold. It must NOT change what the
// desk sees (perNightTypeAvailability feeds the desk, the Tape Chart and the booking guards).

function day(offset: number): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset);
}
const ymd = (d: Date) => formatLocalDay(d.getTime());

describe("Channel availability: pending (unconverted) inbound bookings", () => {
  let enterpriseId: string;
  let propertyId: string;
  let linkId: string;
  let connectionId: string;
  let stdTypeId: string;

  beforeAll(async () => {
    const ent = await prisma.enterprise.create({
      data: { name: `Pending Ent ${Date.now()}`, slug: `test-pending-${Date.now()}`, type: "STANDARD" },
    });
    enterpriseId = ent.id;
    await prisma.enterpriseLicense.create({ data: { enterpriseId, tier: "STANDARD", maxProperties: 2 } });

    propertyId = (await makeChannelProperty(enterpriseId, "Pending Property")).id;
    const { connection, link } = await connectProperty(propertyId);
    connectionId = connection.id;
    linkId = link.id;

    const std = await prisma.roomType.create({ data: { propertyId, name: "Standard", code: "STD", maxOccupancy: 2 } });
    stdTypeId = std.id;
    for (let i = 1; i <= 3; i++) {
      await prisma.room.create({ data: { propertyId, roomTypeId: std.id, roomNumber: `20${i}`, status: "AVAILABLE" } });
    }
    await prisma.channelRoomTypeMap.create({ data: { linkId, roomTypeId: std.id, externalRoomId: "101", shared: true } });
  });

  async function ingest(id: string, arrival: Date, departure: Date, status = "confirmed") {
    return ingestBooking({
      enterpriseId,
      connectionId,
      source: "WEBHOOK",
      parse: parseBeds24Booking,
      isCancelled: isCancelledStatus,
      raw: { id, roomId: 101, arrival: ymd(arrival), departure: ymd(departure), status, firstName: "P", lastName: "Guest" },
    });
  }

  async function published(from: Date, to: Date) {
    const plan = await computeChannelAvailability({ enterpriseId, linkId, from, to });
    return new Map(plan.roomTypes[0].nights.map((n) => [n.date, n.available]));
  }

  it("a received-but-unconverted booking lowers the published count for its nights only", async () => {
    await ingest("pend-1", day(20), day(22));
    const p = await published(day(19), day(23));
    expect(p.get(ymd(day(19)))).toBe(3);
    expect(p.get(ymd(day(20)))).toBe(2);
    expect(p.get(ymd(day(21)))).toBe(2);
    // Half-open stay: the departure night is free again.
    expect(p.get(ymd(day(22)))).toBe(3);
  });

  it("does NOT change the desk's availability (perNightTypeAvailability is untouched)", async () => {
    const desk = await perNightTypeAvailability({ propertyId, roomTypeId: stdTypeId, startDate: day(20), endDate: day(22) });
    expect(desk.every((n) => n.available === 3)).toBe(true);
  });

  it("a booking cancelled at the channel releases its hold", async () => {
    await ingest("pend-2", day(30), day(31));
    expect((await published(day(30), day(31))).get(ymd(day(30)))).toBe(2);
    await ingest("pend-2", day(30), day(31), "cancelled");
    expect((await published(day(30), day(31))).get(ymd(day(30)))).toBe(3);
  });

  it("a converted booking stops counting as pending (its reservation holds the room instead)", async () => {
    await ingest("pend-3", day(40), day(41));
    const row = await prisma.channelInboundBooking.findUniqueOrThrow({
      where: { connectionId_externalBookingId: { connectionId, externalBookingId: "pend-3" } },
    });
    await prisma.channelInboundBooking.update({ where: { id: row.id }, data: { status: "CONVERTED" } });
    // No reservation was actually created in this test, so the room is fully free again —
    // proving the CONVERTED row itself is not double-counted alongside its reservation.
    expect((await published(day(40), day(41))).get(ymd(day(40)))).toBe(3);
  });

  it("never publishes below zero", async () => {
    for (let i = 0; i < 5; i++) await ingest(`pend-over-${i}`, day(50), day(51));
    expect((await published(day(50), day(51))).get(ymd(day(50)))).toBe(0);
  });

  it("an unchanged re-delivery reports no inventory change; a date change does", async () => {
    const first = await ingest("pend-4", day(60), day(61));
    expect(first.inventoryChanged).toBe(true);
    const again = await ingest("pend-4", day(60), day(61));
    expect(again.status).toBe("UPDATED");
    expect(again.inventoryChanged).toBe(false);
    const moved = await ingest("pend-4", day(62), day(63));
    expect(moved.inventoryChanged).toBe(true);
    const cancelled = await ingest("pend-4", day(62), day(63), "cancelled");
    expect(cancelled.inventoryChanged).toBe(true);
  });
});
