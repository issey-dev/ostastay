import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Transportation module — integration tests through the real route handlers
// (.agents/docs/TRANSPORTATION_PLAN.md): configuration, pricing, shared manifests with guests
// from different reservations, attention warnings, Night Audit posting and its idempotency,
// manual post / waive / void, the old Transport-card conversion, property isolation, export.

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
const { createSession, destroySession } = await import("@/lib/auth");
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");
const { ensureChart } = await import("../helpers/charge-codes");
const { setPropertySettings } = await import("../helpers/property-settings");

const settingsRoute = await import("@/app/api/transport/settings/route");
const defaultsRoute = await import("@/app/api/transport/defaults/route");
const configRoute = await import("@/app/api/transport/config/route");
const entityRoute = await import("@/app/api/transport/config/[entity]/route");
const entityIdRoute = await import("@/app/api/transport/config/[entity]/[id]/route");
const bookingsRoute = await import("@/app/api/transport/bookings/route");
const bookingRoute = await import("@/app/api/transport/bookings/[id]/route");
const statusRoute = await import("@/app/api/transport/bookings/[id]/status/route");
const billingRoute = await import("@/app/api/transport/bookings/[id]/billing/route");
const bulkRoute = await import("@/app/api/transport/bookings/bulk/route");
const quoteRoute = await import("@/app/api/transport/quote/route");
const suggestionsRoute = await import("@/app/api/transport/suggestions/route");
const manifestsRoute = await import("@/app/api/transport/manifests/route");
const manifestRoute = await import("@/app/api/transport/manifests/[id]/route");
const manifestBookingsRoute = await import("@/app/api/transport/manifests/[id]/bookings/route");
const fromSlotsRoute = await import("@/app/api/transport/manifests/from-slots/route");
const boardRoute = await import("@/app/api/transport/board/route");
const reportRoute = await import("@/app/api/transport/report/route");
const nightAuditRoute = await import("@/app/api/night-audit/run/route");
const folioVoidRoute = await import("@/app/api/folios/[id]/line-items/[itemId]/void/route");
const simpleRoute = await import("@/app/api/reservations/[id]/transport/route");
const { postDueTransportCharges } = await import("@/lib/transport/billing");
const { getPropertySettings } = await import("@/lib/property-settings");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const BUSINESS_DATE = "2027-03-10";

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

type Handler = (req: Request, ctx: { params: Promise<any> }) => Promise<Response>;
// The HTTP method is the handler's own export name (GET, POST, PATCH, DELETE).
async function call(userId: string, handler: Handler | ((req: Request) => Promise<Response>), url: string, body?: unknown, params: Record<string, string> = {}) {
  const method = handler.name;
  const res = await asUser(userId, () =>
    (handler as Handler)(
      new Request(`http://localhost${url}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { params: Promise.resolve(params) }
    )
  );
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

describe("Transportation module", () => {
  let enterpriseId: string;
  let propertyId: string;
  let otherPropertyId: string;
  let adminId: string;
  let deskId: string;
  let otherPropertyUserId: string;
  let guestId: string;
  let routeId: string;
  let vesselId: string;
  let providerId: string;
  let speedboatId: string;
  let rateId: string;
  let resA: { id: string; folioId: string };
  let resB: { id: string; folioId: string; groupBlockId: string };
  let resC: { id: string };
  const q = (extra = "") => `?propertyId=${propertyId}${extra}`;

  const newReservation = async (opts: { status: string; checkIn: string; checkOut: string; adults?: number; groupBlockId?: string; folio?: boolean }) => {
    const r = await prisma.reservation.create({
      data: {
        propertyId,
        primaryGuestId: guestId,
        confirmationNo: `TR${uniq()}`,
        status: opts.status,
        adults: opts.adults ?? 1,
        checkInDate: D(opts.checkIn),
        checkOutDate: D(opts.checkOut),
        groupBlockId: opts.groupBlockId,
        ...(opts.folio !== false ? { folios: { create: [{ propertyId, folioNumber: 1 }] } } : {}),
      },
      include: { folios: true },
    });
    return { id: r.id, folioId: r.folios[0]?.id ?? "" };
  };

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    void osta;
    const enterprise = await prisma.enterprise.create({ data: { name: "Transport BR", slug: `test-transport-${uniq()}`, type: "STANDARD" } });
    enterpriseId = enterprise.id;
    const roleIds = await ensureRoles(prisma, enterpriseId, SYSTEM_ROLE_DEFS, true);
    const passwordHash = await bcrypt.hash("password123", 10);
    const mkProperty = (name: string) =>
      prisma.property.create({
        data: {
          enterpriseId, name, code: `TRP-${uniq()}`, legalName: `${name} LLC`, defaultCurrency: "USD", timeZone: "Indian/Maldives",
          checkInTime: "14:00", checkOutTime: "12:00", businessDate: D(BUSINESS_DATE),
        },
      });
    const p = await mkProperty("Lagoon Guesthouse");
    propertyId = p.id;
    otherPropertyId = (await mkProperty("Reef Resort")).id;
    for (const id of [propertyId, otherPropertyId]) {
      await ensureChart({ propertyId: id });
      await setPropertySettings(id, { tgstEnabled: false, serviceChargeEnabled: false, greenTaxEnabled: false });
    }
    const mkUser = async (role: string, scope: "ENTERPRISE" | "PROPERTY", workPropertyId?: string) =>
      (
        await prisma.user.create({
          data: {
            enterpriseId, email: `transport-${role.replace(/\s/g, "")}-${uniq()}@test.local`, passwordHash, firstName: role, lastName: "User",
            roles: { create: { roleId: roleIds[role] } }, scope, propertyId: workPropertyId,
          },
        })
      ).id;
    adminId = await mkUser("Admin", "ENTERPRISE");
    deskId = await mkUser("Front Desk", "PROPERTY", propertyId);
    otherPropertyUserId = await mkUser("Admin", "PROPERTY", otherPropertyId);
    guestId = (await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "Aisha", lastName: "Rasheed" } })).upid;

    const group = await prisma.groupBlock.create({
      data: { propertyId, code: `WED${uniq().slice(-4)}`, name: "Wedding party", startDate: D(BUSINESS_DATE), endDate: D("2027-03-14"), status: "DEFINITE" },
    });
    resA = await newReservation({ status: "IN_HOUSE", checkIn: BUSINESS_DATE, checkOut: "2027-03-14" });
    const b = await newReservation({ status: "IN_HOUSE", checkIn: BUSINESS_DATE, checkOut: "2027-03-14", adults: 2, groupBlockId: group.id });
    resB = { ...b, groupBlockId: group.id };
    // The group's guests bill their own folios in this test, not a master.
    await prisma.reservation.update({ where: { id: resB.id }, data: { groupBillToMaster: false } });
    resC = await newReservation({ status: "RESERVED", checkIn: BUSINESS_DATE, checkOut: "2027-03-12" });
  });

  // ── The reservation's simple Transport section (module off) ─────────────────────────

  it("without the module, the reservation's Transport section holds flight no., transport no. and flight time only", async () => {
    const url = `/api/reservations/${resC.id}/transport`;
    const saved = await call(deskId, simpleRoute.PUT, url, {
      pickup: { flightNo: "EK652", transportNo: "SB-12", time: "09:30" },
      dropoff: { flightNo: "", transportNo: "", time: "" },
    }, { id: resC.id });
    expect(saved.status).toBe(200);
    expect(saved.json.managedByModule).toBe(false);
    expect(saved.json.legs.PICKUP).toMatchObject({ flightNo: "EK652", transportNo: "SB-12", flightDate: BUSINESS_DATE, flightTime: "09:30", legacyCharge: null });
    expect(saved.json.legs.DROPOFF).toBeNull();
    // Stored as the property-local time on the arrival day (Maldives is UTC+5); no charge fields.
    const row = await prisma.reservationTransport.findUniqueOrThrow({ where: { reservationId_direction: { reservationId: resC.id, direction: "PICKUP" } } });
    expect(row.carrierTime?.toISOString()).toBe(`${BUSINESS_DATE}T04:30:00.000Z`);
    expect(row.chargeToGuest).toBe(false);
    expect(row.chargeAmount).toBeNull();

    const bad = await call(deskId, simpleRoute.PUT, url, { pickup: { flightNo: "", transportNo: "", time: "25:00" }, dropoff: { flightNo: "", transportNo: "", time: "" } }, { id: resC.id });
    expect(bad.status).toBe(400);
    expect(bad.json.details["pickup.time"]).toBeTruthy();

    // A charge entered on the older card survives an edit and a clear (Night Audit still owns it).
    await prisma.reservationTransport.create({ data: { reservationId: resC.id, direction: "DROPOFF", transportType: "SPB", remarks: "old", chargeToGuest: true, chargeAmount: 40 } });
    const cleared = await call(deskId, simpleRoute.PUT, url, {
      pickup: { flightNo: "", transportNo: "", time: "" },
      dropoff: { flightNo: "", transportNo: "", time: "" },
    }, { id: resC.id });
    expect(cleared.status).toBe(200);
    expect(cleared.json.legs.PICKUP).toBeNull();
    expect(cleared.json.legs.DROPOFF.legacyCharge).toEqual({ amount: 40, posted: false });
    const kept = await prisma.reservationTransport.findUniqueOrThrow({ where: { reservationId_direction: { reservationId: resC.id, direction: "DROPOFF" } } });
    expect(kept).toMatchObject({ chargeToGuest: true, chargeAmount: 40, remarks: "old" });
    await prisma.reservationTransport.delete({ where: { id: kept.id } });

    // Another property's user can't read or write it.
    const foreign = await call(otherPropertyUserId, simpleRoute.GET, url, undefined, { id: resC.id });
    expect(foreign.status).toBe(403);
  });

  // ── Phase 1: configuration ──────────────────────────────────────────────────────────

  it("refuses operations until the add-on is held and the module is switched on, then configures the property", async () => {
    // No add-on: not even the setup is reachable (like Excursions and Spa).
    const noAddon = await call(adminId, configRoute.GET, `/api/transport/config${q()}`);
    expect(noAddon.status).toBe(403);
    expect(noAddon.json.code).toBe("TRANSPORT_ADDON_NOT_ENABLED");
    await prisma.enterpriseAddonAccess.create({ data: { enterpriseId, module: "TRANSPORTATION", enabled: true } });
    const off = await call(adminId, bookingsRoute.GET, `/api/transport/bookings${q()}`);
    expect(off.status).toBe(403);
    expect(off.json.code).toBe("TRANSPORT_NOT_ENABLED");

    const on = await call(adminId, settingsRoute.PATCH, `/api/transport/settings${q()}`, { enabled: true, attentionToleranceMinutes: 60 });
    expect(on.status).toBe(200);
    expect(on.json.enabled).toBe(true);

    const seeded = await call(adminId, defaultsRoute.POST, `/api/transport/defaults${q()}`, {});
    expect(seeded.status).toBe(200);
    expect(seeded.json.created).toEqual(expect.arrayContaining(["Type SPB", "Location MLE", "Location HOME"]));
    // Idempotent: nothing duplicated on a second run.
    const again = await call(adminId, defaultsRoute.POST, `/api/transport/defaults${q()}`, {});
    expect(again.json.created).toEqual([]);

    const config = await call(adminId, configRoute.GET, `/api/transport/config${q()}`);
    expect(config.status).toBe(200);
    expect(config.json.settings.defaultChargeCodeId).toBeTruthy();
    const loc = (code: string) => config.json.locations.find((l: any) => l.code === code).id;
    speedboatId = config.json.types.find((t: any) => t.code === "SPB").id;

    const route = await call(adminId, entityRoute.POST, `/api/transport/config/routes${q()}`, {
      code: "mle-home", name: "Airport to guesthouse", originId: loc("MLE"), destinationId: loc("HOME"), transportTypeId: speedboatId,
      category: "AIRPORT_TRANSFER", direction: "BOTH", durationMinutes: 45, departureSlots: ["14:00", "10:00", "10:00"],
    }, { entity: "routes" });
    expect(route.status).toBe(201);
    expect(route.json.code).toBe("MLE-HOME");
    expect(route.json.departureSlots).toEqual(["10:00", "14:00"]);
    routeId = route.json.id;

    const same = await call(adminId, entityRoute.POST, `/api/transport/config/routes${q()}`, {
      code: "MLE-HOME", name: "Dup", originId: loc("MLE"), destinationId: loc("HOME"), transportTypeId: speedboatId, category: "AIRPORT_TRANSFER", direction: "BOTH",
    }, { entity: "routes" });
    expect(same.status).toBe(409);
    const loop = await call(adminId, entityRoute.POST, `/api/transport/config/routes${q()}`, {
      code: "LOOP", name: "Loop", originId: loc("MLE"), destinationId: loc("MLE"), transportTypeId: speedboatId, category: "LOCAL_TRANSFER", direction: "BOTH",
    }, { entity: "routes" });
    expect(loop.status).toBe(400);

    const provider = await call(adminId, entityRoute.POST, `/api/transport/config/providers${q()}`, { name: "Own speedboats", kind: "OWN", phone: "+960 7000000" }, { entity: "providers" });
    expect(provider.status).toBe(201);
    providerId = provider.json.id;
    const vessel = await call(adminId, entityRoute.POST, `/api/transport/config/vessels${q()}`, { providerId, name: "Blue Marlin", capacity: 3, transportTypeId: speedboatId }, { entity: "vessels" });
    expect(vessel.status).toBe(201);
    vesselId = vessel.json.id;

    const rate = await call(adminId, entityRoute.POST, `/api/transport/config/rates${q()}`, {
      routeId, direction: "BOTH", pricingBasis: "PER_PERSON", adultPrice: 100, childPrice: 50, infantPrice: 0,
      chargeCodeId: config.json.settings.defaultChargeCodeId, taxMode: "CHARGE_CODE",
    }, { entity: "rates" });
    expect(rate.status).toBe(201);
    rateId = rate.json.id;
  });

  it("only property setup (CONTROLS) may change configuration; the desk may read it", async () => {
    const read = await call(deskId, configRoute.GET, `/api/transport/config${q()}`);
    expect(read.status).toBe(200);
    const write = await call(deskId, entityRoute.POST, `/api/transport/config/types${q()}`, { code: "XX", name: "Nope", mode: "LAND" }, { entity: "types" });
    expect(write.status).toBe(403);
  });

  it("a referenced row cannot be deleted — only deactivated", async () => {
    const del = await call(adminId, entityIdRoute.DELETE, `/api/transport/config/types/${speedboatId}${q()}`, undefined, { entity: "types", id: speedboatId });
    expect(del.status).toBe(409);
    expect(del.json.code).toBe("IN_USE");
    const created = await call(adminId, entityRoute.POST, `/api/transport/config/types${q()}`, { code: "TUK", name: "Tuk-tuk", mode: "LAND" }, { entity: "types" });
    const off = await call(adminId, entityIdRoute.PATCH, `/api/transport/config/types/${created.json.id}${q()}`, { isActive: false }, { entity: "types", id: created.json.id });
    expect(off.status).toBe(200);
    expect(off.json.isActive).toBe(false);
    expect(off.json.code).toBe("TUK");
    const gone = await call(adminId, entityIdRoute.DELETE, `/api/transport/config/types/${created.json.id}${q()}`, undefined, { entity: "types", id: created.json.id });
    expect(gone.status).toBe(200);
  });

  // ── Phase 2: bookings, manifests, attention ─────────────────────────────────────────

  let bookingA: string;
  let bookingB: string;
  let bookingC: string;
  let manifestId: string;

  it("prices a booking from the route's rate and defaults pax and date from the reservation", async () => {
    const quote = await call(deskId, quoteRoute.POST, `/api/transport/quote${q()}`, { routeId, direction: "PICKUP", serviceDate: BUSINESS_DATE, adults: 2, children: 1 });
    expect(quote.status).toBe(200);
    expect(quote.json.amount).toBe(250);
    expect(quote.json.preview.grandTotal).toBe(250); // taxes off at this property

    const a = await call(deskId, bookingsRoute.POST, `/api/transport/bookings${q()}`, {
      reservationId: resA.id, direction: "PICKUP", routeId, flightNo: "ek 652", flightTime: "09:30", airline: "Emirates",
    });
    expect(a.status).toBe(201);
    expect(a.json.serviceDate).toBe(BUSINESS_DATE);
    expect(a.json.flightNo).toBe("EK652");
    expect(a.json.flightLocal).toEqual({ dateKey: BUSINESS_DATE, time: "09:30" });
    // 09:30 Maldives (UTC+5) is 04:30 UTC — stored as an instant.
    expect(a.json.flightAt).toBe("2027-03-10T04:30:00.000Z");
    expect(a.json.pricing.amount).toBe(100);
    expect(a.json.billing.status).toBe("NOT_BILLED");
    expect(a.json.guestName).toBe("Aisha Rasheed");
    expect(a.json.needsFlight).toBe(true);
    bookingA = a.json.id;

    const b = await call(deskId, bookingsRoute.POST, `/api/transport/bookings${q()}`, { reservationId: resB.id, direction: "PICKUP", routeId, flightNo: "QR672", flightTime: "08:00" });
    expect(b.status).toBe(201);
    expect(b.json.adults).toBe(2);
    expect(b.json.pricing.amount).toBe(200);
    expect(b.json.groupBlock?.id).toBe(resB.groupBlockId);
    bookingB = b.json.id;

    const c = await call(deskId, bookingsRoute.POST, `/api/transport/bookings${q()}`, { reservationId: resC.id, direction: "PICKUP", routeId });
    bookingC = c.json.id;
    expect(c.status).toBe(201);
  });

  it("price overrides need the billing permission and a reason", async () => {
    const denied = await call(deskId, bookingRoute.PATCH, `/api/transport/bookings/${bookingC}${q()}`, { priceOverride: { amount: 10, reason: "VIP" } }, { id: bookingC });
    expect(denied.status).toBe(403);
    const noReason = await call(adminId, bookingRoute.PATCH, `/api/transport/bookings/${bookingC}${q()}`, { priceOverride: { amount: 10, reason: "" } }, { id: bookingC });
    expect(noReason.status).toBe(400);
    const ok = await call(adminId, bookingRoute.PATCH, `/api/transport/bookings/${bookingC}${q()}`, { priceOverride: { amount: 80, reason: "Returning guest" } }, { id: bookingC });
    expect(ok.status).toBe(200);
    expect(ok.json.pricing).toMatchObject({ amount: 80, priceOverridden: true, overrideReason: "Returning guest" });
    // A pax change keeps a hand-set price.
    const pax = await call(deskId, bookingRoute.PATCH, `/api/transport/bookings/${bookingC}${q()}`, { adults: 3 }, { id: bookingC });
    expect(pax.json.pricing.amount).toBe(80);
  });

  it("builds a shared departure from different reservations, with capacity and attention warnings", async () => {
    const m = await call(deskId, manifestsRoute.POST, `/api/transport/manifests${q()}`, {
      routeId, direction: "PICKUP", serviceDate: BUSINESS_DATE, departureTime: "10:00", providerId, vesselId, bookingIds: [bookingA, bookingB],
    });
    expect(m.status).toBe(201);
    manifestId = m.json.id;
    expect(m.json.pax).toBe(3);
    expect(m.json.capacity).toBe(3);
    expect(m.json.capacityState).toBe("FULL");
    const a = m.json.bookings.find((b: any) => b.id === bookingA);
    expect(a.status).toBe("ASSIGNED");
    // Lands 09:30, boat at 10:00, 60 minutes needed → needs attention. B lands 08:00 → fine.
    expect(a.attention.map((x: any) => x.code)).toContain("TOO_SOON_AFTER_LANDING");
    expect(m.json.bookings.find((b: any) => b.id === bookingB).attention).toEqual([]);
    expect(m.json.attentionCount).toBe(1);

    // Over capacity is a warning, never a block.
    const more = await call(deskId, manifestBookingsRoute.POST, `/api/transport/manifests/${manifestId}/bookings${q()}`, { action: "ATTACH", bookingIds: [bookingC] }, { id: manifestId });
    expect(more.status).toBe(200);
    expect(more.json.capacityState).toBe("OVER");
    const off = await call(deskId, manifestBookingsRoute.POST, `/api/transport/manifests/${manifestId}/bookings${q()}`, { action: "DETACH", bookingIds: [bookingC] }, { id: manifestId });
    expect(off.json.pax).toBe(3);

    // The flight is earlier now: the timing is fine, but the change itself is flagged…
    const moved = await call(deskId, bookingRoute.PATCH, `/api/transport/bookings/${bookingA}${q()}`, { flightTime: "07:45" }, { id: bookingA });
    expect(moved.json.attention.map((x: any) => x.code)).toEqual(["FLIGHT_CHANGED"]);
    // …until someone confirms the booking still fits this departure.
    const keep = await call(deskId, manifestBookingsRoute.POST, `/api/transport/manifests/${manifestId}/bookings${q()}`, { action: "KEEP", bookingIds: [bookingA] }, { id: manifestId });
    expect(keep.json.attentionCount).toBe(0);
  });

  it("refuses a drop-off on a pickup departure", async () => {
    const d = await call(deskId, bookingsRoute.POST, `/api/transport/bookings${q()}`, { reservationId: resA.id, direction: "DROP_OFF", routeId });
    const wrong = await call(deskId, manifestBookingsRoute.POST, `/api/transport/manifests/${manifestId}/bookings${q()}`, { action: "ATTACH", bookingIds: [d.json.id] }, { id: manifestId });
    expect(wrong.status).toBe(400);
    expect(wrong.json.code).toBe("DIRECTION_MISMATCH");
  });

  it("creates the day's departures from the route's default times, once", async () => {
    const first = await call(deskId, fromSlotsRoute.POST, `/api/transport/manifests/from-slots${q()}`, { serviceDate: "2027-03-11", direction: "DROP_OFF" });
    expect(first.json).toEqual({ created: 2, skipped: 0 });
    const again = await call(deskId, fromSlotsRoute.POST, `/api/transport/manifests/from-slots${q()}`, { serviceDate: "2027-03-11", direction: "DROP_OFF" });
    expect(again.json).toEqual({ created: 0, skipped: 2 });
  });

  it("the board groups the day and filters by group block", async () => {
    const board = await call(deskId, boardRoute.GET, `/api/transport/board${q(`&date=${BUSINESS_DATE}`)}`);
    expect(board.status).toBe(200);
    expect(board.json.week).toHaveLength(7);
    expect(board.json.week.find((d: any) => d.date === BUSINESS_DATE).pickups).toBe(3);
    expect(board.json.manifests.map((m: any) => m.id)).toContain(manifestId);
    const grouped = await call(deskId, boardRoute.GET, `/api/transport/board${q(`&date=${BUSINESS_DATE}&groupBlockId=${resB.groupBlockId}`)}`);
    expect(grouped.json.bookings.map((b: any) => b.id)).toEqual([bookingB]);
    const unassigned = await call(deskId, boardRoute.GET, `/api/transport/board${q(`&date=${BUSINESS_DATE}&unassigned=1&direction=PICKUP`)}`);
    expect(unassigned.json.bookings.map((b: any) => b.id)).toEqual([bookingC]);
  });

  it("suggests drafts for arrivals and departures without a booking — never confirmed", async () => {
    const d = await newReservation({ status: "RESERVED", checkIn: "2027-03-12", checkOut: "2027-03-15" });
    const sug = await call(deskId, suggestionsRoute.GET, `/api/transport/suggestions${q("&from=2027-03-12&to=2027-03-12")}`);
    expect(sug.json.some((s: any) => s.reservationId === d.id && s.direction === "PICKUP")).toBe(true);
    const made = await call(deskId, suggestionsRoute.POST, `/api/transport/suggestions${q()}`, { items: [{ reservationId: d.id, direction: "PICKUP" }] });
    expect(made.json).toEqual({ created: 1, skipped: 0 });
    const draft = await prisma.transportBooking.findFirstOrThrow({ where: { reservationId: d.id } });
    expect(draft.status).toBe("DRAFT");
    expect(draft.serviceDate).toEqual(D("2027-03-12"));
  });

  // ── Billing ─────────────────────────────────────────────────────────────────────────

  it("Night Audit posts each arrived guest's pickup once, and never a not-arrived guest's", async () => {
    const run = await call(adminId, nightAuditRoute.POST, "/api/night-audit/run", { propertyId, confirmed: true, reason: "test" });
    expect(run.status).toBe(200);
    expect(run.json.transportChargesPosted).toBe(2);

    const a = await prisma.transportBooking.findUniqueOrThrow({ where: { id: bookingA }, include: { folioLineItem: true } });
    expect(a.billingStatus).toBe("POSTED");
    expect(a.folioLineItem?.folioId).toBe(resA.folioId);
    expect(a.folioLineItem?.amount).toBe(100);
    expect(a.folioLineItem?.date).toEqual(D(BUSINESS_DATE));
    const b = await prisma.transportBooking.findUniqueOrThrow({ where: { id: bookingB }, include: { folioLineItem: true } });
    expect(b.folioLineItem?.folioId).toBe(resB.folioId);
    expect(b.folioLineItem?.amount).toBe(200);
    // C never arrived (RESERVED): no automatic pickup charge.
    expect((await prisma.transportBooking.findUniqueOrThrow({ where: { id: bookingC } })).billingStatus).toBe("NOT_BILLED");

    // Idempotent: the same pass again (a retried audit) posts nothing more.
    const settings = await getPropertySettings(propertyId);
    const again = await prisma.$transaction((tx) =>
      postDueTransportCharges(tx, { propertyId, auditDate: D(BUSINESS_DATE), settings, pricesIncludeTaxes: true })
    );
    expect(again.posted).toBe(0);
    expect(await prisma.folioLineItem.count({ where: { folioId: resA.folioId, description: { startsWith: "Transfer" } } })).toBe(1);
  });

  it("posts a drop-off at the guest's last-night audit, dated the departure day", async () => {
    const r = await newReservation({ status: "IN_HOUSE", checkIn: "2027-03-09", checkOut: "2027-03-12" });
    const d = await call(deskId, bookingsRoute.POST, `/api/transport/bookings${q()}`, { reservationId: r.id, direction: "DROP_OFF", routeId });
    expect(d.json.serviceDate).toBe("2027-03-12");
    // Business date is now the 11th (the previous test's audit rolled it): tonight is the
    // last night, so the drop-off posts, stamped the 12th.
    const run = await call(adminId, nightAuditRoute.POST, "/api/night-audit/run", { propertyId, confirmed: true, reason: "test" });
    expect(run.status).toBe(200);
    const posted = await prisma.transportBooking.findUniqueOrThrow({ where: { id: d.json.id }, include: { folioLineItem: true } });
    expect(posted.billingStatus).toBe("POSTED");
    expect(posted.folioLineItem?.date).toEqual(D("2027-03-12"));
  });

  it("a no-show is never posted automatically; the desk posts a fee by hand with permission and a reason", async () => {
    const ns = await call(deskId, statusRoute.POST, `/api/transport/bookings/${bookingC}/status${q()}`, { status: "NO_SHOW" }, { id: bookingC });
    expect(ns.status).toBe(200);
    expect(ns.json.note).toMatch(/will not post/);

    // The Front Desk role has no Transportation billing (delete) permission.
    const denied = await call(deskId, billingRoute.POST, `/api/transport/bookings/${bookingC}/billing${q()}`, { action: "POST", mode: "CUSTOM", amount: 40, reason: "No-show fee" }, { id: bookingC });
    expect(denied.status).toBe(403);
    const noReason = await call(adminId, billingRoute.POST, `/api/transport/bookings/${bookingC}/billing${q()}`, { action: "POST", mode: "CUSTOM", amount: 40 }, { id: bookingC });
    expect(noReason.status).toBe(400);

    // C has no open folio... it does (created with one); the fee lands there.
    const fee = await call(adminId, billingRoute.POST, `/api/transport/bookings/${bookingC}/billing${q()}`, { action: "POST", mode: "CUSTOM", amount: 40, reason: "No-show fee", description: "Transfer no-show fee" }, { id: bookingC });
    expect(fee.status).toBe(200);
    expect(fee.json.booking.billing.status).toBe("POSTED");
    expect(fee.json.posted.grandTotal).toBe(40);
    const twice = await call(adminId, billingRoute.POST, `/api/transport/bookings/${bookingC}/billing${q()}`, { action: "POST", mode: "FULL" }, { id: bookingC });
    expect(twice.status).toBe(400);
    expect(twice.json.code).toBe("ALREADY_POSTED");

    const log = await prisma.userActivityLog.findFirst({ where: { entityId: bookingC, action: "POST_CHARGE" } });
    expect(log?.description).toMatch(/No-show fee/);
  });

  it("voids through the standard folio void — from the booking or from the folio — and can post again", async () => {
    const voided = await call(adminId, billingRoute.POST, `/api/transport/bookings/${bookingC}/billing${q()}`, { action: "VOID", reason: "Fee waived by manager" }, { id: bookingC });
    expect(voided.status).toBe(200);
    expect(voided.json.booking.billing.status).toBe("VOIDED");
    const line = await prisma.folioLineItem.findFirstOrThrow({ where: { id: voided.json.booking.billing.folioLineItemId } });
    expect(line.isVoid).toBe(true);

    // Voided on the folio screen instead: the booking follows.
    const b = await prisma.transportBooking.findUniqueOrThrow({ where: { id: bookingB } });
    const folioVoid = await call(adminId, folioVoidRoute.POST, `/api/folios/${resB.folioId}/line-items/${b.folioLineItemId}/void`, { reason: "Wrong boat" }, { id: resB.folioId, itemId: b.folioLineItemId! });
    expect(folioVoid.status).toBe(200);
    expect((await prisma.transportBooking.findUniqueOrThrow({ where: { id: bookingB } })).billingStatus).toBe("VOIDED");
    // A voided transfer can be charged again (one live posting at a time).
    const repost = await call(adminId, billingRoute.POST, `/api/transport/bookings/${bookingB}/billing${q()}`, { action: "POST", mode: "FULL" }, { id: bookingB });
    expect(repost.status).toBe(200);
    expect(repost.json.booking.billing.status).toBe("POSTED");
  });

  it("waives and resumes; bulk posting reports each booking", async () => {
    const r = await newReservation({ status: "IN_HOUSE", checkIn: "2027-03-09", checkOut: "2027-03-20" });
    const x = await call(deskId, bookingsRoute.POST, `/api/transport/bookings${q()}`, { reservationId: r.id, direction: "DROP_OFF", routeId });
    const w = await call(adminId, billingRoute.POST, `/api/transport/bookings/${x.json.id}/billing${q()}`, { action: "WAIVE", reason: "Package" }, { id: x.json.id });
    expect(w.json.booking.billing.status).toBe("WAIVED");
    const resume = await call(adminId, billingRoute.POST, `/api/transport/bookings/${x.json.id}/billing${q()}`, { action: "RESUME" }, { id: x.json.id });
    expect(resume.json.booking.billing.status).toBe("NOT_BILLED");
    const bulk = await call(adminId, bulkRoute.POST, `/api/transport/bookings/bulk${q()}`, { action: "POST", bookingIds: [x.json.id, bookingA] });
    expect(bulk.status).toBe(200);
    expect(bulk.json.done).toBe(1);
    expect(bulk.json.failed).toEqual([expect.objectContaining({ error: expect.stringMatching(/already charged/) })]);
  });

  it("a standalone traveller is billed on a walk-in folio", async () => {
    const s = await call(deskId, bookingsRoute.POST, `/api/transport/bookings${q()}`, {
      direction: "PICKUP", serviceDate: "2027-03-11", guestName: "Ibrahim Local", guestContact: "+960 7771234", routeId, adults: 1,
    });
    expect(s.status).toBe(201);
    expect(s.json.reservation).toBeNull();
    const posted = await call(adminId, billingRoute.POST, `/api/transport/bookings/${s.json.id}/billing${q()}`, { action: "POST", mode: "FULL" }, { id: s.json.id });
    expect(posted.status).toBe(200);
    const folio = await prisma.folio.findUniqueOrThrow({ where: { id: posted.json.posted.folioId } });
    expect(folio.reservationId).toBeNull();
    expect(folio.walkInGuestName).toBe("Ibrahim Local");
    const noName = await call(deskId, bookingsRoute.POST, `/api/transport/bookings${q()}`, { direction: "PICKUP", serviceDate: "2027-03-11", routeId });
    expect(noName.status).toBe(400);
  });

  it("converts the older Transport card's leg without charging twice", async () => {
    const r = await newReservation({ status: "IN_HOUSE", checkIn: "2027-03-09", checkOut: "2027-03-13" });
    const config = await call(adminId, configRoute.GET, `/api/transport/config${q()}`);
    const line = await prisma.folioLineItem.create({
      data: { folioId: r.folioId, chargeCodeId: config.json.settings.defaultChargeCodeId, date: D("2027-03-09"), description: "Transport – Pickup", amount: 60 },
    });
    await prisma.reservationTransport.create({
      data: { reservationId: r.id, direction: "PICKUP", carrierCode: "EK652", carrierTime: new Date("2027-03-09T05:00:00Z"), chargeToGuest: true, chargeAmount: 60, chargeCodeId: config.json.settings.defaultChargeCodeId, chargedLineItemId: line.id },
    });
    const b = await call(deskId, bookingsRoute.POST, `/api/transport/bookings${q()}`, { reservationId: r.id, direction: "PICKUP", routeId });
    expect(b.status).toBe(201);
    expect(b.json.flightNo).toBe("EK652");
    expect(b.json.billing.status).toBe("POSTED");
    expect(b.json.billing.folioLineItemId).toBe(line.id);
    expect(await prisma.reservationTransport.count({ where: { reservationId: r.id } })).toBe(0);
  });

  it("with the module on, the reservation's Transport section is read-only and filled from its bookings", async () => {
    const r = await newReservation({ status: "RESERVED", checkIn: "2027-03-15", checkOut: "2027-03-18" });
    const url = `/api/reservations/${r.id}/transport`;
    const refused = await call(adminId, simpleRoute.PUT, url, {
      pickup: { flightNo: "QR672", transportNo: "", time: "" },
      dropoff: { flightNo: "", transportNo: "", time: "" },
    }, { id: r.id });
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe("MANAGED_BY_TRANSPORTATION");

    const b = await call(deskId, bookingsRoute.POST, `/api/transport/bookings${q()}`, {
      reservationId: r.id, direction: "PICKUP", routeId, flightNo: "QR672", flightTime: "08:15", vesselId, providerId,
    });
    expect(b.status).toBe(201);
    const view = await call(deskId, simpleRoute.GET, url, undefined, { id: r.id });
    expect(view.status).toBe(200);
    expect(view.json.managedByModule).toBe(true);
    expect(view.json.legs.PICKUP).toMatchObject({ flightNo: "QR672", transportNo: "Blue Marlin", flightDate: "2027-03-15", flightTime: "08:15" });
    expect(view.json.legs.DROPOFF).toBeNull();
  });

  // ── Isolation and export ────────────────────────────────────────────────────────────

  it("never reads or writes across properties", async () => {
    await call(adminId, settingsRoute.PATCH, `/api/transport/settings?propertyId=${otherPropertyId}`, { enabled: true });
    // A booking id from this property, asked for under the other property: not found.
    const cross = await call(adminId, bookingRoute.GET, `/api/transport/bookings/${bookingA}?propertyId=${otherPropertyId}`, undefined, { id: bookingA });
    expect(cross.status).toBe(404);
    const crossManifest = await call(adminId, manifestBookingsRoute.POST, `/api/transport/manifests/${manifestId}/bookings?propertyId=${otherPropertyId}`, { action: "ATTACH", bookingIds: [bookingA] }, { id: manifestId });
    expect(crossManifest.status).toBe(404);
    // A route of this property used on the other property's booking: refused.
    const foreignRef = await call(adminId, bookingsRoute.POST, `/api/transport/bookings?propertyId=${otherPropertyId}`, { direction: "PICKUP", serviceDate: BUSINESS_DATE, guestName: "X", routeId });
    expect(foreignRef.status).toBe(400);
    expect(foreignRef.json.code).toBe("INVALID_REFERENCE");
    // A single-property user of the other property cannot open this property at all.
    const otherUser = await call(otherPropertyUserId, boardRoute.GET, `/api/transport/board${q(`&date=${BUSINESS_DATE}`)}`);
    expect(otherUser.status).toBe(403);
    const otherConfig = await call(otherPropertyUserId, configRoute.GET, `/api/transport/config${q()}`);
    expect(otherConfig.status).toBe(403);
    // And the other property's list is empty of this property's bookings.
    const list = await call(adminId, bookingsRoute.GET, `/api/transport/bookings?propertyId=${otherPropertyId}&from=2027-03-01&to=2027-03-31`);
    expect(list.json.items).toEqual([]);
  });

  it("exports the daily report as CSV and PDF, rate-limited", async () => {
    const csv = await call(deskId, reportRoute.GET, `/api/transport/report${q(`&from=${BUSINESS_DATE}&to=2027-03-12&format=csv`)}`);
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toMatch(/csv/);
    expect(csv.json).toMatch(/Aisha Rasheed/);
    expect(csv.json).toMatch(/EK652/);
    const pdf = await asUser(deskId, () => reportRoute.GET(new Request(`http://localhost/api/transport/report${q(`&from=${BUSINESS_DATE}&format=pdf`)}`)));
    expect(pdf.status).toBe(200);
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
    const tooLong = await call(deskId, reportRoute.GET, `/api/transport/report${q("&from=2027-01-01&to=2027-06-01")}`);
    expect(tooLong.status).toBe(400);
    let limited = 0;
    for (let i = 0; i < 12; i++) {
      const r = await call(deskId, reportRoute.GET, `/api/transport/report${q(`&from=${BUSINESS_DATE}&format=json`)}`);
      if (r.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it("completing a departure completes its passengers; cancelling one releases them", async () => {
    const done = await call(deskId, manifestRoute.PATCH, `/api/transport/manifests/${manifestId}${q()}`, { status: "COMPLETED" }, { id: manifestId });
    expect(done.status).toBe(200);
    expect(done.json.manifest.bookings.find((b: any) => b.id === bookingA).status).toBe("COMPLETED");
    const m2 = await call(deskId, manifestsRoute.POST, `/api/transport/manifests${q()}`, { routeId, direction: "DROP_OFF", serviceDate: "2027-03-14", departureTime: "09:00" });
    const d = await call(deskId, bookingsRoute.POST, `/api/transport/bookings${q()}`, { reservationId: resB.id, direction: "DROP_OFF", routeId });
    await call(deskId, manifestBookingsRoute.POST, `/api/transport/manifests/${m2.json.id}/bookings${q()}`, { action: "ATTACH", bookingIds: [d.json.id] }, { id: m2.json.id });
    const cancelled = await call(deskId, manifestRoute.PATCH, `/api/transport/manifests/${m2.json.id}${q()}`, { status: "CANCELLED" }, { id: m2.json.id });
    expect(cancelled.json.cascade.released).toBe(1);
    const after = await prisma.transportBooking.findUniqueOrThrow({ where: { id: d.json.id } });
    expect(after.manifestId).toBeNull();
    expect(after.status).toBe("CONFIRMED");
  });
});
