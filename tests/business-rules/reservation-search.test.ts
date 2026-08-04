import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

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
const { ensureRoles, SYSTEM_ROLE_DEFS } = await import("../../prisma/rbac-seed-data");
const reservationsRoute = await import("@/app/api/reservations/route");

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

// The reservations list's ONE search field and its date modes (app-owner, 2026-08-03):
// "vital info search with one field", a date range switchable between arrival / stay /
// departure, and finished business hidden unless explicitly asked for.
describe("Reservation search", () => {
  let propertyId: string;
  let enterpriseId: string;
  let userId: string;
  const stamp = Date.now();
  const ids: Record<string, string> = {};

  const call = async (qs: string) => {
    const res = await reservationsRoute.GET(new Request(`http://localhost/api/reservations?propertyId=${propertyId}&${qs}`));
    expect(res.status).toBe(200);
    return (await res.json()) as { id: string; confirmationNo: string; status: string }[];
  };
  const confs = (rows: { confirmationNo: string }[]) => rows.map((r) => r.confirmationNo).sort();

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const ent = await prisma.enterprise.create({
      data: { name: `Search ${stamp}`, slug: `test-search-${stamp}`, type: "STANDARD" },
    });
    enterpriseId = ent.id;
    await prisma.enterpriseLicense.create({ data: { enterpriseId, tier: "STANDARD", maxProperties: 1 } });

    const property = await prisma.property.create({
      data: {
        enterpriseId,
        name: "Search Property",
        code: `SRCH-${stamp}`,
        legalName: "Search LLC",
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
        status: "ACTIVE",
        businessDate: utc(2026, 8, 1),
      },
    });
    propertyId = property.id;

    const rt = await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } });
    const rp = await prisma.ratePlan.create({
      data: { propertyId, code: "BASE", name: "Base", priority: 999, isLocked: true },
    });
    const room = await prisma.room.create({
      data: { propertyId, roomTypeId: rt.id, roomNumber: "911", status: "AVAILABLE" },
    });

    const guest = await prisma.profile.create({
      data: {
        enterpriseId,
        firstName: "Ingrid",
        lastName: "Bergman",
        profileType: "GUEST",
        communications: { create: [{ type: "EMAIL", value: "ingrid@example.com" }, { type: "MOBILE", value: "+9607771234" }] },
      },
    });
    const other = await prisma.profile.create({
      data: { enterpriseId, firstName: "Other", lastName: "Person", profileType: "GUEST" },
    });

    const mk = async (key: string, opts: { conf: string; status: string; ci: Date; co: Date; guestId?: string; roomId?: string; externalRef?: string }) => {
      const r = await prisma.reservation.create({
        data: {
          confirmationNo: opts.conf,
          propertyId,
          primaryGuestId: opts.guestId ?? other.upid,
          checkInDate: opts.ci,
          checkOutDate: opts.co,
          adults: 1,
          status: opts.status,
          externalRef: opts.externalRef ?? null,
          assignments: {
            create: { roomTypeId: rt.id, ratePlanId: rp.id, roomId: opts.roomId ?? null, startDate: opts.ci, endDate: opts.co },
          },
        },
      });
      ids[key] = r.id;
      return r;
    };

    // Arrives 05 Aug, departs 08 Aug — the one carrying every searchable detail.
    await mk("live", { conf: `S-LIVE-${stamp}`, status: "RESERVED", ci: utc(2026, 8, 5), co: utc(2026, 8, 8), guestId: guest.upid, roomId: room.id, externalRef: "BEDS-4242" });
    // Arrives 20 Aug — outside a 01–10 Aug window on every mode.
    await mk("later", { conf: `S-LATER-${stamp}`, status: "RESERVED", ci: utc(2026, 8, 20), co: utc(2026, 8, 22) });
    // Spans the window without arriving or departing inside it.
    await mk("spanning", { conf: `S-SPAN-${stamp}`, status: "IN_HOUSE", ci: utc(2026, 7, 28), co: utc(2026, 8, 25) });
    // Finished business — hidden by default.
    await mk("out", { conf: `S-OUT-${stamp}`, status: "CHECKED_OUT", ci: utc(2026, 8, 6), co: utc(2026, 8, 7) });
    await mk("noshow", { conf: `S-NOSHOW-${stamp}`, status: "NO_SHOW", ci: utc(2026, 8, 6), co: utc(2026, 8, 7) });

    const user = await prisma.user.create({
      data: {
        enterpriseId,
        email: `search-${stamp}@test.local`,
        passwordHash: await bcrypt.hash("password123", 10),
        firstName: "Search",
        lastName: "User",
        roles: { create: { roleId: roleIds["Admin"] } },
        scope: "ENTERPRISE",
      },
    });
    userId = user.id;

    cookieJar.clear();
    await createSession(userId);
  });

  // ---------------------------------------------------------------------------
  // Finished business
  // ---------------------------------------------------------------------------

  it("hides checked-out and no-show reservations by default", async () => {
    const rows = await call("take=100");
    const found = confs(rows);
    expect(found).toContain(`S-LIVE-${stamp}`);
    expect(found).not.toContain(`S-OUT-${stamp}`);
    expect(found).not.toContain(`S-NOSHOW-${stamp}`);
  });

  it("returns them when the status is asked for explicitly", async () => {
    expect(confs(await call("status=CHECKED_OUT"))).toContain(`S-OUT-${stamp}`);
    expect(confs(await call("status=NO_SHOW"))).toContain(`S-NOSHOW-${stamp}`);
    // …and asking for both still excludes the live one, i.e. it really is the filter.
    expect(confs(await call("status=CHECKED_OUT,NO_SHOW"))).not.toContain(`S-LIVE-${stamp}`);
  });

  // ---------------------------------------------------------------------------
  // One field, every vital detail
  // ---------------------------------------------------------------------------

  it("finds one booking by any of its vital details", async () => {
    for (const term of [
      `S-LIVE-${stamp}`,   // confirmation number
      "BEDS-4242",          // channel booking reference
      "Bergman",            // guest surname
      "ingrid@example",     // email, held in ProfileCommunication
      "7771234",            // phone, likewise
      "911",                // room number, through the assignment
    ]) {
      const rows = await call(`search=${encodeURIComponent(term)}`);
      expect(confs(rows), `searching "${term}"`).toContain(`S-LIVE-${stamp}`);
    }
  });

  it("search is case-insensitive", async () => {
    expect(confs(await call("search=bergman"))).toContain(`S-LIVE-${stamp}`);
    expect(confs(await call("search=BERGMAN"))).toContain(`S-LIVE-${stamp}`);
  });

  // ---------------------------------------------------------------------------
  // Date modes
  // ---------------------------------------------------------------------------

  it("stay mode returns everything overlapping the range", async () => {
    const found = confs(await call("from=2026-08-01&to=2026-08-10&dateMode=stay"));
    expect(found).toContain(`S-LIVE-${stamp}`);
    // Spans the window without arriving or departing in it — only stay mode catches it.
    expect(found).toContain(`S-SPAN-${stamp}`);
    expect(found).not.toContain(`S-LATER-${stamp}`);
  });

  it("arrival mode returns only arrivals inside the range", async () => {
    const found = confs(await call("from=2026-08-01&to=2026-08-10&dateMode=arrival"));
    expect(found).toContain(`S-LIVE-${stamp}`);
    expect(found).not.toContain(`S-SPAN-${stamp}`);
    expect(found).not.toContain(`S-LATER-${stamp}`);
  });

  it("departure mode returns only departures inside the range", async () => {
    const found = confs(await call("from=2026-08-01&to=2026-08-10&dateMode=departure"));
    expect(found).toContain(`S-LIVE-${stamp}`);
    expect(found).not.toContain(`S-SPAN-${stamp}`);
    expect(found).not.toContain(`S-LATER-${stamp}`);
  });

  it("treats the range end as inclusive", async () => {
    // The live booking arrives ON 05 Aug; a range ending that day must include it.
    expect(confs(await call("from=2026-08-05&to=2026-08-05&dateMode=arrival"))).toContain(`S-LIVE-${stamp}`);
  });

  it("defaults to stay mode when none is given", async () => {
    const withMode = confs(await call("from=2026-08-01&to=2026-08-10&dateMode=stay"));
    const without = confs(await call("from=2026-08-01&to=2026-08-10"));
    expect(without).toEqual(withMode);
  });
});
