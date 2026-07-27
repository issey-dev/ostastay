import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

process.env.SECRETS_ENCRYPTION_KEY = "test-push-key";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { prisma } = await import("@/lib/db");
const { compactNights, buildCalendarPayload, countNights } = await import("@/lib/channels/payload");
const { pushAvailabilityForLink, pushAllEnabledLinks } = await import("@/lib/channels/push");
const { ForbiddenError } = await import("@/lib/scope");
const { formatLocalDay } = await import("@/lib/availability");

function day(offset: number): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset);
}
const d = (offset: number) => formatLocalDay(day(offset).getTime());

function stubFetch(response: unknown, ok = true, status = 200) {
  const spy = vi.fn(async () => ({ ok, status, json: async () => response }) as unknown as Response);
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("Channel push", () => {
  // ---------------------------------------------------------------------------
  // The payload builder — pure, and the part whose wire format cannot yet be
  // checked against a live account, so it carries the heaviest testing.
  // ---------------------------------------------------------------------------

  describe("compactNights", () => {
    it("collapses consecutive identical nights into one inclusive range", () => {
      expect(
        compactNights([
          { date: "2026-03-01", available: 3, closed: false },
          { date: "2026-03-02", available: 3, closed: false },
          { date: "2026-03-03", available: 3, closed: false },
        ])
      ).toEqual([{ from: "2026-03-01", to: "2026-03-03", numAvail: 3 }]);
    });

    it("splits when the number changes", () => {
      expect(
        compactNights([
          { date: "2026-03-01", available: 3, closed: false },
          { date: "2026-03-02", available: 1, closed: false },
          { date: "2026-03-03", available: 3, closed: false },
        ])
      ).toEqual([
        { from: "2026-03-01", to: "2026-03-01", numAvail: 3 },
        { from: "2026-03-02", to: "2026-03-02", numAvail: 1 },
        { from: "2026-03-03", to: "2026-03-03", numAvail: 3 },
      ]);
    });

    it("never merges a CLOSED night with an equally-zero open night", () => {
      // Both are 0, but they mean different things at the channel — closed removes the
      // listing, 0 leaves it up as sold out. Merging them would silently discard the
      // distinction the D-7 ruling exists to preserve.
      const ranges = compactNights([
        { date: "2026-03-01", available: 0, closed: false },
        { date: "2026-03-02", available: 0, closed: true },
        { date: "2026-03-03", available: 0, closed: false },
      ]);
      expect(ranges).toHaveLength(3);
      expect(ranges[1]).toEqual({ from: "2026-03-02", to: "2026-03-02", numAvail: 0, closed: true });
      // `closed` is omitted rather than sent as false on open nights.
      expect("closed" in ranges[0]).toBe(false);
    });

    it("merges consecutive closed nights with each other", () => {
      expect(
        compactNights([
          { date: "2026-03-01", available: 0, closed: true },
          { date: "2026-03-02", available: 0, closed: true },
        ])
      ).toEqual([{ from: "2026-03-01", to: "2026-03-02", numAvail: 0, closed: true }]);
    });

    it("does NOT merge across a gap in dates", () => {
      // A non-contiguous pair with the same value must stay separate, or the missing day
      // would be silently overwritten with a value never computed for it.
      expect(
        compactNights([
          { date: "2026-03-01", available: 2, closed: false },
          { date: "2026-03-05", available: 2, closed: false },
        ])
      ).toEqual([
        { from: "2026-03-01", to: "2026-03-01", numAvail: 2 },
        { from: "2026-03-05", to: "2026-03-05", numAvail: 2 },
      ]);
    });

    it("merges correctly across a month boundary", () => {
      expect(
        compactNights([
          { date: "2026-03-31", available: 1, closed: false },
          { date: "2026-04-01", available: 1, closed: false },
        ])
      ).toEqual([{ from: "2026-03-31", to: "2026-04-01", numAvail: 1 }]);
    });

    it("handles an empty night list", () => {
      expect(compactNights([])).toEqual([]);
    });
  });

  describe("buildCalendarPayload / countNights", () => {
    const plan = {
      linkId: "l",
      propertyId: "p",
      propertyName: "P",
      externalPropertyId: "x",
      syncEnabled: true,
      from: "2026-03-01",
      to: "2026-03-04",
      excluded: [{ roomTypeId: "gone", roomTypeName: "Gone", reason: "Not mapped" }],
      roomTypes: [
        {
          roomTypeId: "a",
          roomTypeName: "A",
          roomTypeCode: "A",
          externalRoomId: "beds-a",
          nights: [
            { date: "2026-03-01", available: 2, closed: false },
            { date: "2026-03-02", available: 2, closed: false },
            { date: "2026-03-03", available: 0, closed: true },
          ],
        },
      ],
    };

    it("emits one entry per mapped room type, keyed by the CHANNEL's room id", () => {
      const payload = buildCalendarPayload(plan);
      expect(payload).toHaveLength(1);
      // Our own room type id must never appear — the channel only knows its own ids.
      expect(payload[0].roomId).toBe("beds-a");
      expect(payload[0].calendar).toEqual([
        { from: "2026-03-01", to: "2026-03-02", numAvail: 2 },
        { from: "2026-03-03", to: "2026-03-03", numAvail: 0, closed: true },
      ]);
    });

    it("OMITS excluded room types entirely rather than sending them as zero", () => {
      const payload = buildCalendarPayload(plan);
      // Sending 0 for an excluded type would actively close inventory the operator only
      // meant to stop managing from here — absence and zero are not the same instruction.
      expect(JSON.stringify(payload)).not.toContain("gone");
      expect(payload.every((r) => r.roomId !== "gone")).toBe(true);
    });

    it("counts nights across compacted ranges", () => {
      expect(countNights(buildCalendarPayload(plan))).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // The guards — the reason this is safe to run against a real account.
  // ---------------------------------------------------------------------------

  describe("guards", () => {
    let enterpriseId: string;
    let linkId: string;
    let connectionId: string;

    beforeAll(async () => {
      const ent = await prisma.enterprise.create({
        data: { name: `Push Ent ${Date.now()}`, slug: `test-push-${Date.now()}`, type: "STANDARD" },
      });
      enterpriseId = ent.id;
      await prisma.enterpriseLicense.create({ data: { enterpriseId, tier: "STANDARD", maxProperties: 2 } });

      const property = await prisma.property.create({
        data: {
          enterpriseId,
          name: "Push Property",
          code: `PU-${Date.now()}`,
          legalName: "Push LLC",
          defaultCurrency: "USD",
          timeZone: "UTC",
          checkInTime: "14:00",
          checkOutTime: "11:00",
        },
      });

      const connection = await prisma.channelConnection.create({
        data: { enterpriseId, provider: "BEDS24", name: `Push Conn ${Date.now()}`, refreshToken: "stored" },
      });
      connectionId = connection.id;

      const link = await prisma.channelPropertyLink.create({
        data: { connectionId, propertyId: property.id, externalPropertyId: "ext-push", syncEnabled: false },
      });
      linkId = link.id;

      const rt = await prisma.roomType.create({
        data: { propertyId: property.id, name: "Standard", code: "STD", maxOccupancy: 2 },
      });
      await prisma.room.create({
        data: { propertyId: property.id, roomTypeId: rt.id, roomNumber: "201", status: "AVAILABLE" },
      });
      await prisma.channelRoomTypeMap.create({
        data: { linkId, roomTypeId: rt.id, externalRoomId: "beds-std", shared: true },
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("REFUSES to send while sharing is off, and makes no outbound call", async () => {
      const spy = stubFetch({});
      const result = await pushAvailabilityForLink({ enterpriseId, linkId });

      expect(result.status).toBe("SKIPPED");
      expect(result.reason).toContain("Sharing is off");
      // syncEnabled is the operator's consent to publish. A job, a retry, or any future
      // caller must not be able to route around it.
      expect(spy).not.toHaveBeenCalled();
    });

    it("ALLOWS a dry run while sharing is off, and still sends nothing", async () => {
      const spy = stubFetch({});
      const result = await pushAvailabilityForLink({ enterpriseId, linkId, dryRun: true, days: 3 });

      expect(result.status).toBe("DRY_RUN");
      expect(result.payload?.[0].roomId).toBe("beds-std");
      expect(result.nightCount).toBe(3);
      // Inspecting the body before it reaches an OTA is the entire point of dry run.
      expect(spy).not.toHaveBeenCalled();
    });

    it("really sends once sharing is on, and reports what went", async () => {
      await prisma.channelPropertyLink.update({ where: { id: linkId }, data: { syncEnabled: true } });
      // First call refreshes the access token, second is the calendar push.
      const spy = stubFetch({ token: "fresh-access", expiresIn: 86400 });

      const result = await pushAvailabilityForLink({ enterpriseId, linkId, days: 4 });

      expect(result.status).toBe("PUSHED");
      expect(result.roomTypeCount).toBe(1);
      expect(result.nightCount).toBe(4);

      const calls = spy.mock.calls as unknown as [string, RequestInit][];
      const push = calls.find(([url]) => String(url).includes("/inventory/rooms/calendar"));
      expect(push).toBeTruthy();
      expect(push![1].method).toBe("POST");
      const body = JSON.parse(String(push![1].body));
      expect(body[0].roomId).toBe("beds-std");
    });

    it("records the push in the exchange log without leaking the access token", async () => {
      await prisma.channelSyncLog.deleteMany({ where: { enterpriseId } });
      stubFetch({ token: "SECRET-ACCESS-TOKEN-XYZ", expiresIn: 86400 });

      await pushAvailabilityForLink({ enterpriseId, linkId, days: 2 });

      const logs = await prisma.channelSyncLog.findMany({ where: { enterpriseId } });
      const push = logs.find((l) => l.operation === "calendar.push");
      expect(push).toBeTruthy();
      expect(push!.direction).toBe("OUTBOUND");
      // The push carries the access token in its header; none of it may reach the log.
      expect(JSON.stringify(logs)).not.toContain("SECRET-ACCESS-TOKEN-XYZ");
    });

    it("reports a failure instead of throwing, so one property cannot abort a sweep", async () => {
      stubFetch({ error: "Beds24 is unavailable" }, false, 503);
      const result = await pushAvailabilityForLink({ enterpriseId, linkId, days: 2 });

      expect(result.status).toBe("FAILED");
      expect(result.reason).toBeTruthy();
    });

    it("skips a link with no mapped room types rather than pushing an empty body", async () => {
      const bare = await prisma.property.create({
        data: {
          enterpriseId,
          name: "Bare",
          code: `BA-${Date.now()}`,
          legalName: "Bare LLC",
          defaultCurrency: "USD",
          timeZone: "UTC",
          checkInTime: "14:00",
          checkOutTime: "11:00",
        },
      });
      const bareLink = await prisma.channelPropertyLink.create({
        data: { connectionId, propertyId: bare.id, externalPropertyId: "ext-bare", syncEnabled: true },
      });

      const spy = stubFetch({});
      const result = await pushAvailabilityForLink({ enterpriseId, linkId: bareLink.id });

      // An empty push would look like a success while saying nothing — it would hide a
      // broken mapping rather than surface it.
      expect(result.status).toBe("SKIPPED");
      expect(result.reason).toContain("No room types");
      expect(spy).not.toHaveBeenCalled();
    });

    it("pushAllEnabledLinks only touches links that are actually sharing", async () => {
      await prisma.channelPropertyLink.updateMany({ where: { connectionId }, data: { syncEnabled: false } });
      await prisma.channelPropertyLink.update({ where: { id: linkId }, data: { syncEnabled: true } });
      stubFetch({ token: "t", expiresIn: 86400 });

      const results = await pushAllEnabledLinks(enterpriseId);
      expect(results).toHaveLength(1);
      expect(results[0].linkId).toBe(linkId);
    });

    it("refuses a link belonging to another enterprise", async () => {
      const other = await prisma.enterprise.create({
        data: { name: `Push Other ${Date.now()}`, slug: `test-pusho-${Date.now()}`, type: "STANDARD" },
      });
      await expect(
        pushAvailabilityForLink({ enterpriseId: other.id, linkId })
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("pushes real computed numbers, not a fixed payload", async () => {
      await prisma.channelPropertyLink.update({ where: { id: linkId }, data: { syncEnabled: true } });
      stubFetch({ token: "t", expiresIn: 86400 });

      const result = await pushAvailabilityForLink({ enterpriseId, linkId, dryRun: true, days: 2 });
      // One sellable room and nothing booked.
      expect(result.payload![0].calendar[0]).toMatchObject({ from: d(0), numAvail: 1 });
    });
  });
});
