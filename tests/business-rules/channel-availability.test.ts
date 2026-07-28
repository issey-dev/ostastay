import { describe, it, expect, beforeAll, vi } from "vitest";

process.env.SECRETS_ENCRYPTION_KEY = "test-channel-avail-key";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { prisma } = await import("@/lib/db");
const { computeChannelAvailability, resolveWindow } = await import("@/lib/channels/sync");
const { perNightTypeAvailability, formatLocalDay } = await import("@/lib/availability");
const { ForbiddenError } = await import("@/lib/scope");

const DAY_MS = 86_400_000;

/** Local midnight N days from today — matches how the availability lib bins nights. */
function day(offset: number): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset);
}

describe("Channel availability (outbound sync)", () => {
  let enterpriseId: string;
  let propertyId: string;
  let linkId: string;
  let stdTypeId: string;
  let guestUpid: string;
  let ratePlanId: string;

  beforeAll(async () => {
    const ent = await prisma.enterprise.create({
      data: { name: `Avail Ent ${Date.now()}`, slug: `test-avail-${Date.now()}`, type: "STANDARD" },
    });
    enterpriseId = ent.id;
    await prisma.enterpriseLicense.create({ data: { enterpriseId, tier: "STANDARD", maxProperties: 2 } });

    const property = await prisma.property.create({
      data: {
        enterpriseId,
        name: "Avail Property",
        code: `AV-${Date.now()}`,
        legalName: "Avail LLC",
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });
    propertyId = property.id;

    const connection = await prisma.channelConnection.create({
      data: { enterpriseId, provider: "BEDS24", name: `Avail Conn ${Date.now()}`, refreshToken: "x" },
    });
    const link = await prisma.channelPropertyLink.create({
      data: { connectionId: connection.id, propertyId, externalPropertyId: "ext-avail", syncEnabled: false },
    });
    linkId = link.id;

    // 3 sellable rooms of the standard type.
    const std = await prisma.roomType.create({
      data: { propertyId, name: "Standard", code: "STD", maxOccupancy: 2 },
    });
    stdTypeId = std.id;
    for (let i = 1; i <= 3; i++) {
      await prisma.room.create({
        data: { propertyId, roomTypeId: std.id, roomNumber: `10${i}`, status: "AVAILABLE" },
      });
    }
    await prisma.channelRoomTypeMap.create({
      data: { linkId, roomTypeId: std.id, externalRoomId: "beds-std", shared: true },
    });

    const guest = await prisma.profile.create({
      data: { enterpriseId, profileType: "GUEST", firstName: "Avail", lastName: "Guest" },
    });
    guestUpid = guest.upid;

    // RoomAssignment requires a rate plan; availability never reads it, but the row cannot
    // exist without one.
    ratePlanId = (
      await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "Best Available" } })
    ).id;
  });

  async function reserve(roomTypeId: string, from: Date, to: Date, status = "RESERVED") {
    const res = await prisma.reservation.create({
      data: {
        confirmationNo: `AV${Date.now()}${Math.floor(Math.random() * 1000)}`,
        propertyId,
        primaryGuestId: guestUpid,
        checkInDate: from,
        checkOutDate: to,
        status,
        adults: 1,
      },
    });
    await prisma.roomAssignment.create({
      data: { reservationId: res.id, roomTypeId, ratePlanId, startDate: from, endDate: to },
    });
    return res;
  }

  async function plan(days = 5) {
    return computeChannelAvailability({ enterpriseId, linkId, from: day(0), to: day(days) });
  }

  // ---------------------------------------------------------------------------
  // Rule 1 — publish actual availability, never overbooking headroom.
  // ---------------------------------------------------------------------------

  it("publishes capacity when nothing is booked", async () => {
    const p = await plan(3);
    const std = p.roomTypes.find((r) => r.roomTypeId === stdTypeId)!;
    expect(std.externalRoomId).toBe("beds-std");
    expect(std.nights).toHaveLength(3);
    expect(std.nights.every((n) => n.available === 3)).toBe(true);
  });

  it("subtracts inventory-holding reservations night by night", async () => {
    await reserve(stdTypeId, day(1), day(2));

    const p = await plan(3);
    const nights = p.roomTypes.find((r) => r.roomTypeId === stdTypeId)!.nights;
    // Only the booked night drops — a per-night calendar, not a window minimum.
    expect(nights.find((n) => n.date === formatLocalDay(day(0).getTime()))!.available).toBe(3);
    expect(nights.find((n) => n.date === formatLocalDay(day(1).getTime()))!.available).toBe(2);
    expect(nights.find((n) => n.date === formatLocalDay(day(2).getTime()))!.available).toBe(3);
  });

  it("a cancelled reservation releases its room back to the channel", async () => {
    const res = await reserve(stdTypeId, day(3), day(4));
    let nights = (await plan(5)).roomTypes[0].nights;
    expect(nights.find((n) => n.date === formatLocalDay(day(3).getTime()))!.available).toBe(2);

    await prisma.reservation.update({ where: { id: res.id }, data: { status: "CANCELLED" } });
    nights = (await plan(5)).roomTypes[0].nights;
    expect(nights.find((n) => n.date === formatLocalDay(day(3).getTime()))!.available).toBe(3);
  });

  it("NEVER publishes a negative number when a manual overbook has oversold the type", async () => {
    // Four reservations against three rooms — the desk deliberately overbooked.
    for (let i = 0; i < 4; i++) await reserve(stdTypeId, day(10), day(11));

    const nights = (await computeChannelAvailability({
      enterpriseId,
      linkId,
      from: day(10),
      to: day(11),
    })).roomTypes[0].nights;

    // Clamped to 0, never -1. Publishing a negative (or, worse, headroom) is exactly what
    // the D-7 ruling forbids: the channel must never be able to cause an overbook.
    expect(nights[0].available).toBe(0);
  });

  it("out-of-order rooms reduce published capacity", async () => {
    const room = await prisma.room.findFirst({ where: { propertyId, roomTypeId: stdTypeId } });
    await prisma.room.update({ where: { id: room!.id }, data: { status: "OUT_OF_ORDER" } });

    const nights = (await plan(2)).roomTypes[0].nights;
    expect(nights[0].available).toBe(2);

    await prisma.room.update({ where: { id: room!.id }, data: { status: "AVAILABLE" } });
  });

  // ---------------------------------------------------------------------------
  // Rule 3 — group holds withheld until cutoff, then released.
  // ---------------------------------------------------------------------------

  it("withholds group-block held rooms before the cutoff and releases them after", async () => {
    const block = await prisma.groupBlock.create({
      data: {
        propertyId,
        code: `GB${Date.now()}`,
        name: "Test Block",
        startDate: day(20),
        endDate: day(22),
        cutoffDate: day(10), // still in the future
        status: "DEFINITE",
      },
    });
    await prisma.groupBlockRoom.create({
      data: { groupBlockId: block.id, roomTypeId: stdTypeId, quantity: 2 },
    });

    let nights = (await computeChannelAvailability({
      enterpriseId,
      linkId,
      from: day(20),
      to: day(21),
    })).roomTypes[0].nights;
    // 3 rooms − 2 held = 1 publishable while the group can still pick up.
    expect(nights[0].available).toBe(1);

    // Move the cutoff into the past — the group can no longer pick up (the pickup route
    // enforces this), so holding the rooms back would only lose sales.
    await prisma.groupBlock.update({ where: { id: block.id }, data: { cutoffDate: day(-1) } });

    nights = (await computeChannelAvailability({
      enterpriseId,
      linkId,
      from: day(20),
      to: day(21),
    })).roomTypes[0].nights;
    expect(nights[0].available).toBe(3);

    await prisma.groupBlockRoom.deleteMany({ where: { groupBlockId: block.id } });
    await prisma.groupBlock.delete({ where: { id: block.id } });
  });

  it("a block with NO cutoff holds its rooms indefinitely rather than releasing them", async () => {
    const block = await prisma.groupBlock.create({
      data: {
        propertyId,
        code: `GBN${Date.now()}`,
        name: "No Cutoff Block",
        startDate: day(30),
        endDate: day(32),
        cutoffDate: null,
        status: "DEFINITE",
      },
    });
    await prisma.groupBlockRoom.create({
      data: { groupBlockId: block.id, roomTypeId: stdTypeId, quantity: 1 },
    });

    const nights = (await computeChannelAvailability({
      enterpriseId,
      linkId,
      from: day(30),
      to: day(31),
    })).roomTypes[0].nights;
    // "No cutoff" means the group may pick up at any time, so the hold stands. Releasing
    // here would be the dangerous reading of the rule.
    expect(nights[0].available).toBe(2);

    await prisma.groupBlockRoom.deleteMany({ where: { groupBlockId: block.id } });
    await prisma.groupBlock.delete({ where: { id: block.id } });
  });

  // ---------------------------------------------------------------------------
  // Rule 5 — stop-sale closes, it does not merely zero.
  // ---------------------------------------------------------------------------

  it("a stop-sale marks the night CLOSED and zeroes it, not just zeroes it", async () => {
    const target = day(40);
    await prisma.availabilityRestriction.create({
      data: { propertyId, roomTypeId: stdTypeId, date: target },
    });

    const nights = (await computeChannelAvailability({
      enterpriseId,
      linkId,
      from: day(40),
      to: day(42),
    })).roomTypes[0].nights;

    // closed is a distinct signal from available: 0 alone reads as "sold out" to several
    // OTAs and keeps the listing live, whereas closed removes it.
    expect(nights[0]).toMatchObject({ available: 0, closed: true });
    expect(nights[1]).toMatchObject({ available: 3, closed: false });

    await prisma.availabilityRestriction.deleteMany({ where: { propertyId, date: target } });
  });

  it("a property-wide stop-sale (null room type) closes every room type", async () => {
    const target = day(45);
    await prisma.availabilityRestriction.create({
      data: { propertyId, roomTypeId: null, date: target },
    });

    const nights = (await computeChannelAvailability({
      enterpriseId,
      linkId,
      from: day(45),
      to: day(46),
    })).roomTypes[0].nights;
    expect(nights[0]).toMatchObject({ available: 0, closed: true });

    await prisma.availabilityRestriction.deleteMany({ where: { propertyId, date: target } });
  });

  // ---------------------------------------------------------------------------
  // What must never be published, and why
  // ---------------------------------------------------------------------------

  it("NEVER publishes a pseudo room type — it has no physical rooms behind it", async () => {
    const pseudo = await prisma.roomType.create({
      data: { propertyId, name: "Overbook Buffer", code: "PSE", maxOccupancy: 2, isPseudo: true },
    });
    await prisma.channelRoomTypeMap.create({
      data: { linkId, roomTypeId: pseudo.id, externalRoomId: "beds-pseudo", shared: true },
    });

    const p = await plan(2);
    // Mapped AND shared, yet still excluded — publishing it would sell rooms that do not
    // exist, which is the whole point of a pseudo type.
    expect(p.roomTypes.find((r) => r.roomTypeId === pseudo.id)).toBeUndefined();
    expect(p.excluded.find((e) => e.roomTypeId === pseudo.id)?.reason).toContain("Pseudo");

    await prisma.channelRoomTypeMap.deleteMany({ where: { roomTypeId: pseudo.id } });
    await prisma.roomType.delete({ where: { id: pseudo.id } });
  });

  it("excludes inactive, unmapped and held-back room types, each with a stated reason", async () => {
    const inactive = await prisma.roomType.create({
      data: { propertyId, name: "Closed Wing", code: "INA", maxOccupancy: 2, isActive: false },
    });
    const unmapped = await prisma.roomType.create({
      data: { propertyId, name: "Brand New", code: "NEW", maxOccupancy: 2 },
    });
    const heldBack = await prisma.roomType.create({
      data: { propertyId, name: "Direct Only", code: "DIR", maxOccupancy: 2 },
    });
    await prisma.channelRoomTypeMap.create({
      data: { linkId, roomTypeId: heldBack.id, externalRoomId: "beds-dir", shared: false },
    });

    const p = await plan(2);
    const reasonFor = (id: string) => p.excluded.find((e) => e.roomTypeId === id)?.reason ?? "";

    expect(reasonFor(inactive.id)).toContain("inactive");
    // A room type added AFTER sharing was enabled lands here — the readiness gate cannot
    // catch that case, so it must be handled rather than assumed away.
    expect(reasonFor(unmapped.id)).toContain("Not mapped");
    expect(reasonFor(heldBack.id)).toContain("Held back");
    expect(p.roomTypes.map((r) => r.roomTypeId)).not.toContain(heldBack.id);

    await prisma.channelRoomTypeMap.deleteMany({ where: { roomTypeId: heldBack.id } });
    await prisma.roomType.deleteMany({ where: { id: { in: [inactive.id, unmapped.id, heldBack.id] } } });
  });

  // ---------------------------------------------------------------------------
  // Correctness of the date handling itself
  // ---------------------------------------------------------------------------

  it("formatLocalDay reports the local calendar date, not a UTC-shifted one", () => {
    const local = new Date(2026, 0, 15); // 15 Jan 2026, local midnight
    expect(formatLocalDay(local.getTime())).toBe("2026-01-15");
    // toISOString() would report 2026-01-14 in any timezone ahead of UTC — a day-shifted
    // push would move real inventory onto the wrong night.
  });

  it("returns one entry per night and no entry for a zero-length window", async () => {
    const nights = await perNightTypeAvailability({
      propertyId,
      roomTypeId: stdTypeId,
      startDate: day(50),
      endDate: day(53),
    });
    expect(nights.map((n) => n.date)).toEqual([50, 51, 52].map((d) => formatLocalDay(day(d).getTime())));

    expect(
      await perNightTypeAvailability({
        propertyId,
        roomTypeId: stdTypeId,
        startDate: day(50),
        endDate: day(50),
      })
    ).toEqual([]);
  });

  it("resolveWindow clamps the requested span", () => {
    // 366, not 365 — a full year must never be clipped short by landing on a leap year.
    expect(resolveWindow(null, 500).to.getTime() - resolveWindow(null, 500).from.getTime()).toBe(366 * DAY_MS);
    expect(resolveWindow(null, 0).to.getTime() - resolveWindow(null, 0).from.getTime()).toBe(DAY_MS);
    // A junk date falls back to today rather than producing an Invalid Date window.
    expect(Number.isNaN(resolveWindow("not-a-date", 7).from.getTime())).toBe(false);
  });

  it("refuses a link belonging to another enterprise", async () => {
    const other = await prisma.enterprise.create({
      data: { name: `Avail Other ${Date.now()}`, slug: `test-availo-${Date.now()}`, type: "STANDARD" },
    });
    await expect(
      computeChannelAvailability({ enterpriseId: other.id, linkId, from: day(0), to: day(1) })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
