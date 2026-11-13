import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Agent Portal plan Phase 3 (9.3.0): Source profiles, the Source on a reservation, negotiated
// rates via the Source, and booking marker resolution.

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
}));

const { prisma } = await import("@/lib/db");
const { createSession } = await import("@/lib/auth");
const { requireSession } = await import("@/lib/scope");
const { ensureRoles, SYSTEM_ROLE_DEFS } = await import("../../prisma/rbac-seed-data");
const { createReservation } = await import("@/lib/reservations/create-reservation");
const { resolveMarker, nextUnusedColor, DEFAULT_MARKER_RULES } = await import("@/lib/booking-markers");
const { parseMarkerRules, saveMarkerRules, getMarkerRules } = await import("@/lib/booking-markers-server");
const profilesRoute = await import("@/app/api/profiles/route");
const convertRoute = await import("@/app/api/profiles/[upid]/convert-to-source/route");
const { serverToday } = await import("@/lib/business-date");
const groupRoute = await import("@/app/api/groups/[id]/route");
const { applyBlockProfiles } = await import("@/lib/groups/block-profiles");

const DAY = 86_400_000;

describe("resolveMarker (pure)", () => {
  const base = { status: "RESERVED" };
  it("a plain desk booking has no marker", () => {
    expect(resolveMarker(base)).toBeNull();
  });
  it("tentative and overflow state win over who booked it", () => {
    const src = { upid: "s1", name: "Sun Tours", markerIcon: "Star", markerColor: "rose" };
    expect(resolveMarker({ status: "TENTATIVE", source: src })?.label).toBe("Tentative");
    expect(resolveMarker({ ...base, isOverflow: true, source: src })?.label).toBe("Overflow");
  });
  it("a source with its own icon and colour shows that, ahead of the rules", () => {
    const m = resolveMarker({ ...base, source: { upid: "s1", name: "Sun Tours", markerIcon: "Star", markerColor: "rose" } });
    expect(m).toEqual({ icon: "Star", color: "rose", label: "Sun Tours" });
  });
  it("a source with only a colour keeps the rule's icon in its colour", () => {
    const m = resolveMarker({ ...base, source: { upid: "s1", name: "Sun Tours", markerColor: "teal" } });
    expect(m).toEqual({ icon: "Briefcase", color: "teal", label: "Sun Tours" });
  });
  it("falls through to travel agent, group, website, channel", () => {
    expect(resolveMarker({ ...base, travelAgentId: "t" })?.label).toBe("Travel agent");
    expect(resolveMarker({ ...base, groupBlockId: "g" })?.label).toBe("Group");
    expect(resolveMarker({ ...base, origin: "WEBSITE" })?.label).toBe("Brand website");
    expect(resolveMarker({ ...base, origin: "CHANNEL" })?.label).toBe("Channel");
  });
  it("first match wins and inactive rules are skipped", () => {
    const rules = [
      { label: "Off", match: "CHANNEL" as const, icon: "Flag" as const, colorToken: "red" as const, isActive: false },
      ...DEFAULT_MARKER_RULES,
    ];
    expect(resolveMarker({ ...base, origin: "CHANNEL" }, rules)?.label).toBe("Channel");
  });
  it("a new source gets a colour no other source uses", () => {
    expect(nextUnusedColor([])).toBe("sky");
    expect(nextUnusedColor(["sky", "teal"])).toBe("rose");
  });
  it("rejects unknown icons, colours and conditions", () => {
    expect(parseMarkerRules([{ label: "x", match: "SOURCE", icon: "Rocket", colorToken: "sky" }])).toMatch(/icon/);
    expect(parseMarkerRules([{ label: "x", match: "SOURCE", icon: "Star", colorToken: "neon" }])).toMatch(/colour/);
    expect(parseMarkerRules([{ label: "x", match: "MOON", icon: "Star", colorToken: "sky" }])).toMatch(/condition/);
  });
});

describe("Source profiles on reservations", () => {
  let enterpriseId: string;
  let propertyId: string;
  let roomTypeId: string;
  let guestUpid: string;
  let adminId: string;
  const stamp = Date.now();
  const at = (o: number) => new Date(serverToday().getTime() + (40 + o) * DAY);
  const signIn = async () => {
    cookieJar.clear();
    await createSession(adminId);
    return requireSession();
  };

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const ent = await prisma.enterprise.create({ data: { name: `Src ${stamp}`, slug: `test-src-${stamp}`, type: "STANDARD" } });
    enterpriseId = ent.id;
    await prisma.enterpriseLicense.create({ data: { enterpriseId, tier: "STANDARD", maxProperties: 1 } });
    propertyId = (
      await prisma.property.create({
        data: {
          enterpriseId, name: "Src Property", code: `SRC-${stamp}`, legalName: "Src LLC", defaultCurrency: "USD",
          timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", status: "ACTIVE", businessDate: serverToday(),
        },
      })
    ).id;
    roomTypeId = (await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } })).id;
    await prisma.room.createMany({ data: [1, 2, 3].map((n) => ({ propertyId, roomTypeId, roomNumber: `10${n}`, status: "AVAILABLE" })) });
    await prisma.ratePlan.create({ data: { propertyId, code: "BASE", name: "Base", priority: 999, isLocked: true } });
    guestUpid = (await prisma.profile.create({ data: { enterpriseId, firstName: "G", lastName: "S", profileType: "GUEST" } })).upid;
    adminId = (
      await prisma.user.create({
        data: { enterpriseId, email: `src-${stamp}@test.local`, passwordHash: await bcrypt.hash("x", 4), firstName: "A", lastName: "D", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" },
      })
    ).id;
  });

  const post = (body: unknown) =>
    profilesRoute.POST(new Request("http://x/api/profiles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  it("a new Source gets settings and a free marker colour; bad values are dropped", async () => {
    await signIn();
    const a = await (await post({ profileType: "SOURCE", firstName: "Sun Tours", companyName: "Sun Tours", settlementMode: "GUEST_DIRECT", earlyAccessDays: 14, portalAutoConfirm: true })).json();
    expect(a.profileType).toBe("SOURCE");
    expect(a.settlementMode).toBe("GUEST_DIRECT");
    expect(a.earlyAccessDays).toBe(14);
    expect(a.portalAutoConfirm).toBe(true);
    expect(a.markerColor).toBe("sky");
    const b = await (await post({ profileType: "SOURCE", firstName: "Reef", companyName: "Reef Travel", settlementMode: "BITCOIN", markerIcon: "Rocket" })).json();
    expect(b.settlementMode).toBeNull();
    expect(b.markerColor).toBe("teal");
    expect(b.markerIcon).toBe("Briefcase");
  });

  // Owner, 2026-11-13: a block's Travel Agent / Company and Source are carried by its
  // reservations and locked there; Bill to may be any credit account, a Source included.
  it("a reservation in a block takes the block's profiles and cannot change them", async () => {
    const ctx = await signIn();
    const blockTa = await prisma.profile.create({ data: { enterpriseId, firstName: "BT", companyName: "Block TA", profileType: "TRAVEL_AGENT" } });
    const other = await prisma.profile.create({ data: { enterpriseId, firstName: "OT", companyName: "Other TA", profileType: "TRAVEL_AGENT" } });
    const src = await prisma.profile.create({ data: { enterpriseId, firstName: "BS", companyName: "Block Source", profileType: "SOURCE", isCreditAccount: true } });
    const base = await prisma.ratePlan.findFirstOrThrow({ where: { propertyId, code: "BASE" } });
    const block = await prisma.groupBlock.create({
      data: { propertyId, code: `BP${stamp % 10000}`, name: "Profiles", startDate: at(10), endDate: at(14), status: "TENTATIVE", totalRoomsHeld: 2, travelAgentId: blockTa.upid, sourceProfileId: src.upid, roomHolds: { create: { roomTypeId, quantity: 2 } } },
    });
    const made = await createReservation(ctx, {
      propertyId, primaryGuestId: guestUpid, checkInDate: at(10), checkOutDate: at(12), roomTypeId, ratePlanId: base.id, adults: 1,
      groupBlockId: block.id, travelAgentId: other.upid, sourceProfileId: null,
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: made.reservation.id } });
    expect(row.travelAgentId).toBe(blockTa.upid);
    expect(row.sourceProfileId).toBe(src.upid);

    // An edit cannot change them while the block sets them.
    const edit = await applyBlockProfiles({ travelAgentId: other.upid, sourceProfileId: null as string | null }, block.id);
    expect(edit).toEqual({ travelAgentId: blockTa.upid, sourceProfileId: src.upid });

    // The block can bill to its Source; a new Travel Agent on the block reaches the pickups.
    const put = await groupRoute.PUT(
      new Request("http://x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ payeeProfileId: src.upid, travelAgentId: other.upid }) }),
      { params: Promise.resolve({ id: block.id }) }
    );
    expect(put.status).toBe(200);
    expect((await prisma.groupBlock.findUniqueOrThrow({ where: { id: block.id } })).payeeProfileId).toBe(src.upid);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: row.id } })).travelAgentId).toBe(other.upid);

    // A guest profile is refused as the block's travel agent.
    const bad = await groupRoute.PUT(
      new Request("http://x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ travelAgentId: guestUpid }) }),
      { params: Promise.resolve({ id: block.id }) }
    );
    expect(bad.status).toBe(400);
  });

  it("a booking carries a Source beside its Travel Agent, and the Source unlocks negotiated rates", async () => {
    const ctx = await signIn();
    const source = await prisma.profile.create({ data: { enterpriseId, firstName: "Atoll", companyName: "Atoll DMC", profileType: "SOURCE" } });
    const ta = await prisma.profile.create({ data: { enterpriseId, firstName: "TA", companyName: "Some TA", profileType: "TRAVEL_AGENT" } });
    const plan = await prisma.ratePlan.create({ data: { propertyId, code: `NEG${stamp % 1000}`, name: "Atoll contract", isNegotiated: true } });
    await prisma.ratePlanAgentAccess.create({ data: { ratePlanId: plan.id, upid: source.upid } });

    const withTaOnly = await createReservation(ctx, {
      propertyId, primaryGuestId: guestUpid, checkInDate: at(0), checkOutDate: at(2), roomTypeId, ratePlanId: plan.id, adults: 1, travelAgentId: ta.upid,
    });
    expect(withTaOnly.ok).toBe(false);

    const ok = await createReservation(ctx, {
      propertyId, primaryGuestId: guestUpid, checkInDate: at(0), checkOutDate: at(2), roomTypeId, ratePlanId: plan.id, adults: 1,
      travelAgentId: ta.upid, sourceProfileId: source.upid,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const row = await prisma.reservation.findUniqueOrThrow({ where: { id: ok.reservation.id } });
      expect(row.sourceProfileId).toBe(source.upid);
      expect(row.travelAgentId).toBe(ta.upid);
    }

    // A guest profile is not a Source.
    const bad = await createReservation(ctx, {
      propertyId, primaryGuestId: guestUpid, checkInDate: at(3), checkOutDate: at(4), roomTypeId, ratePlanId: plan.id, adults: 1, sourceProfileId: guestUpid,
    });
    expect(bad.ok).toBe(false);
  });

  it("lock-in: a party on negotiated rates may book only those (per property)", async () => {
    const ctx = await signIn();
    const base = await prisma.ratePlan.findFirstOrThrow({ where: { propertyId, code: "BASE" } });
    const ta = await prisma.profile.create({ data: { enterpriseId, firstName: "Lock", companyName: "Lock TA", profileType: "TRAVEL_AGENT" } });
    const free = await prisma.profile.create({ data: { enterpriseId, firstName: "Free", companyName: "Free TA", profileType: "TRAVEL_AGENT" } });
    const neg = await prisma.ratePlan.create({ data: { propertyId, code: `LK${stamp % 1000}`, name: "Lock contract", isNegotiated: true } });
    await prisma.ratePlanAgentAccess.create({ data: { ratePlanId: neg.id, upid: ta.upid } });
    const book = (ratePlanId: string, extra: Record<string, unknown>, o: number) =>
      createReservation(ctx, { propertyId, primaryGuestId: guestUpid, checkInDate: at(10 + o), checkOutDate: at(11 + o), roomTypeId, ratePlanId, adults: 1, ...extra });

    const blocked = await book(base.id, { travelAgentId: ta.upid }, 0);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toMatch(/negotiated/);
    expect((await book(neg.id, { travelAgentId: ta.upid }, 1)).ok).toBe(true);
    // As a Source the same rule holds (a Source linked to the plan).
    const src = await prisma.profile.create({ data: { enterpriseId, firstName: "LS", companyName: "Lock Source", profileType: "SOURCE" } });
    await prisma.ratePlanAgentAccess.create({ data: { ratePlanId: neg.id, upid: src.upid } });
    expect((await book(base.id, { sourceProfileId: src.upid }, 2)).ok).toBe(false);
    // A party with no links books as before.
    expect((await book(base.id, { travelAgentId: free.upid }, 3)).ok).toBe(true);

    // A link at ANOTHER property does not lock this one.
    const other = await prisma.property.create({
      data: { enterpriseId, name: "Other", code: `OTH-${stamp}`, legalName: "O", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", status: "ACTIVE", businessDate: serverToday() },
    });
    const away = await prisma.ratePlan.create({ data: { propertyId: other.id, code: "AWAY", name: "Away", isNegotiated: true } });
    await prisma.ratePlanAgentAccess.create({ data: { ratePlanId: away.id, upid: free.upid } });
    expect((await book(base.id, { travelAgentId: free.upid }, 4)).ok).toBe(true);
  });

  it("a travel agent converts to a source", async () => {
    await signIn();
    const ta = await prisma.profile.create({ data: { enterpriseId, firstName: "Old", companyName: "Old TA", profileType: "TRAVEL_AGENT", commissionRate: 8 } });
    const res = await convertRoute.POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ upid: ta.upid }) });
    const body = await res.json();
    expect(body.profileType).toBe("SOURCE");
    expect(body.commissionRate).toBe(8);
    expect(body.markerColor).toBeTruthy();
  });

  it("marker rules: defaults until saved, then the saved order", async () => {
    expect((await getMarkerRules(propertyId)).map((r) => r.match)).toEqual(DEFAULT_MARKER_RULES.map((r) => r.match));
    const rules = parseMarkerRules([
      { label: "Channel", match: "CHANNEL", icon: "Link2", colorToken: "indigo" },
      { label: "Tentative", match: "TENTATIVE", icon: "Clock", colorToken: "amber", isActive: false },
    ]);
    if (typeof rules === "string") throw new Error(rules);
    await saveMarkerRules(propertyId, rules);
    const saved = await getMarkerRules(propertyId);
    expect(saved.map((r) => [r.match, r.isActive])).toEqual([["CHANNEL", true], ["TENTATIVE", false]]);
  });
});
