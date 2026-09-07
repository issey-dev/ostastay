import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// The saved Operations Dashboard arrangement (/api/dashboard/layout).
//
// Two things are worth pinning here, and only one of them is about storage:
//
//   · A layout belongs to ONE USER AND ONE PROPERTY. Keyed on the user alone (as it
//     briefly was), a person's second property inherited whichever arrangement they
//     tidied last — the bug this endpoint's shape exists to prevent.
//   · The endpoint now accepts a propertyId from the client, which is a tenant-scoped
//     identifier. Without assertPropertyAccess a caller could name another enterprise's
//     property and write rows against it, so the cross-tenant case is a real test, not a
//     formality.
//
// Same in-memory cookie fake as the other session-touching suites.
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
const { defaultLayout } = await import("@/lib/dashboard/layout");
const { WIDGET_CATALOG } = await import("@/lib/dashboard/widgets");
const layoutRoute = await import("@/app/api/dashboard/layout/route");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

const getLayout = (propertyId: string) =>
  layoutRoute.GET(new Request(`http://localhost/api/dashboard/layout?propertyId=${propertyId}`));

const putLayout = (propertyId: string, layout: unknown) =>
  layoutRoute.PUT(
    new Request("http://localhost/api/dashboard/layout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId, layout }),
    })
  );

const deleteLayout = (propertyId: string) =>
  layoutRoute.DELETE(new Request(`http://localhost/api/dashboard/layout?propertyId=${propertyId}`, { method: "DELETE" }));

/** A layout distinguishable from any other by the name of its first page. */
function layoutNamed(name: string) {
  const base = defaultLayout(WIDGET_CATALOG);
  return { ...base, pages: [{ ...base.pages[0], name }] };
}

describe("Dashboard layout: per user, per property", () => {
  let userId: string;
  let otherUserId: string;
  let propertyAId: string;
  let propertyBId: string;
  let foreignPropertyId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterprise = await prisma.enterprise.create({
      data: { name: `Layout Ent ${uniq()}`, slug: `test-layout-${uniq()}`, type: "STANDARD" },
    });
    const foreign = await prisma.enterprise.create({
      data: { name: `Layout Foreign ${uniq()}`, slug: `test-layout-foreign-${uniq()}`, type: "STANDARD" },
    });

    const mkProperty = (enterpriseId: string, name: string) =>
      prisma.property.create({
        data: {
          enterpriseId,
          name,
          code: `DL-${uniq()}`,
          legalName: `${name} LLC`,
          defaultCurrency: "USD",
          timeZone: "UTC",
          checkInTime: "14:00",
          checkOutTime: "11:00",
        },
      });

    propertyAId = (await mkProperty(enterprise.id, "City Hotel")).id;
    propertyBId = (await mkProperty(enterprise.id, "Island Resort")).id;
    foreignPropertyId = (await mkProperty(foreign.id, "Someone Else's")).id;

    const passwordHash = await bcrypt.hash("password123", 10);
    const mkUser = async (enterpriseId: string, tag: string) =>
      (
        await prisma.user.create({
          data: {
            enterpriseId,
            email: `${tag}-${uniq()}@layout.local`,
            passwordHash,
            firstName: tag,
            lastName: "User",
            scope: "ENTERPRISE",
            roles: { create: { roleId: roleIds["Admin"] } },
          },
        })
      ).id;

    userId = await mkUser(enterprise.id, "owner");
    otherUserId = await mkUser(enterprise.id, "colleague");
  });

  it("starts with no saved layout, and saves one against the property it was made on", async () => {
    const before = await asUser(userId, () => getLayout(propertyAId));
    expect(before.status).toBe(200);
    expect((await before.json()).layout).toBeNull();

    const saved = await asUser(userId, () => putLayout(propertyAId, layoutNamed("City desk")));
    expect(saved.status).toBe(200);

    const after = await asUser(userId, () => getLayout(propertyAId));
    expect((await after.json()).layout.pages[0].name).toBe("City desk");
  });

  it("keeps a second property's arrangement separate rather than inheriting the first", async () => {
    // The whole point of the composite key: arranging the city hotel must not rearrange
    // the island resort, and an unarranged property gets the shipped default rather than
    // borrowing a layout its owner never chose for it.
    const untouched = await asUser(userId, () => getLayout(propertyBId));
    expect((await untouched.json()).layout).toBeNull();

    await asUser(userId, () => putLayout(propertyBId, layoutNamed("Resort desk")));

    const [a, b] = await Promise.all([
      asUser(userId, () => getLayout(propertyAId)).then((r) => r.json()),
      asUser(userId, () => getLayout(propertyBId)).then((r) => r.json()),
    ]);
    expect(a.layout.pages[0].name).toBe("City desk");
    expect(b.layout.pages[0].name).toBe("Resort desk");
  });

  it("resets one property only, leaving the other's arrangement alone", async () => {
    const gone = await asUser(userId, () => deleteLayout(propertyAId));
    expect(gone.status).toBe(200);

    const [a, b] = await Promise.all([
      asUser(userId, () => getLayout(propertyAId)).then((r) => r.json()),
      asUser(userId, () => getLayout(propertyBId)).then((r) => r.json()),
    ]);
    expect(a.layout).toBeNull();
    expect(b.layout.pages[0].name).toBe("Resort desk");
  });

  it("gives two people on the same property their own arrangement", async () => {
    await asUser(otherUserId, () => putLayout(propertyBId, layoutNamed("Colleague's own")));

    const [mine, theirs] = await Promise.all([
      asUser(userId, () => getLayout(propertyBId)).then((r) => r.json()),
      asUser(otherUserId, () => getLayout(propertyBId)).then((r) => r.json()),
    ]);
    expect(mine.layout.pages[0].name).toBe("Resort desk");
    expect(theirs.layout.pages[0].name).toBe("Colleague's own");
  });

  it("refuses another enterprise's property, and writes nothing", async () => {
    const read = await asUser(userId, () => getLayout(foreignPropertyId));
    expect(read.status).toBe(403);
    // The MESSAGE is a flat "Property not found" whether the id belongs to another
    // enterprise or to nobody, so the response cannot be used to probe which ids exist.
    expect((await read.json()).error).toBe("Property not found");

    const write = await asUser(userId, () => putLayout(foreignPropertyId, layoutNamed("Trespass")));
    expect(write.status).toBe(403);
    expect(await prisma.userDashboardLayout.count({ where: { propertyId: foreignPropertyId } })).toBe(0);
  });

  it("requires a property and rejects anything that is not a layout", async () => {
    const noProperty = await layoutRoute.GET(new Request("http://localhost/api/dashboard/layout"));
    expect(noProperty.status).toBe(401);

    const junk = await asUser(userId, () => putLayout(propertyAId, { nonsense: true }));
    expect(junk.status).toBe(400);

    const missingProperty = await asUser(userId, () =>
      layoutRoute.PUT(
        new Request("http://localhost/api/dashboard/layout", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layout: layoutNamed("No property") }),
        })
      )
    );
    expect(missingProperty.status).toBe(400);
  });
});
