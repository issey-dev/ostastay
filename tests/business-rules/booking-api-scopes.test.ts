import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Phase 1 of BOOKING_API_ADDONS_PLAN.md — one key for Rooms, Excursions and Spa:
//  - key scopes, validated against the enterprise's add-ons when granted,
//  - ROOMS-only endpoints refuse a key without the ROOMS scope,
//  - the property's `modules` block reports each module's live state, in the order a
//    property administrator would fix it, and re-checks the add-on on every request,
//  - the Hub's per-property online settings and per-item publishing.

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
const { customChargeCode } = await import("../helpers/charge-codes");
import { setPropertySettings } from "../helpers/property-settings";
const hubKeysRoute = await import("@/app/api/hub/website/keys/route");
const hubKeyRoute = await import("@/app/api/hub/website/keys/[id]/route");
const hubActivityRoute = await import("@/app/api/hub/website/activities/[propertyId]/route");
const hubItemRoute = await import("@/app/api/hub/website/activity-items/[id]/route");
const propertyRoute = await import("@/app/api/website/v1/properties/[propertyId]/route");
const availabilityRoute = await import("@/app/api/website/v1/properties/[propertyId]/availability/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const json = (method: string, body: unknown) =>
  new Request("http://localhost/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const api = (path: string, key: string) =>
  new Request(`http://localhost/api/website/v1${path}`, { headers: { authorization: `Bearer ${key}` } });
const params = <P,>(p: P) => ({ params: Promise.resolve(p) });

describe("Booking API scopes and online settings (Phase 1)", () => {
  let enterpriseId: string;
  let otherEnterpriseId: string;
  let propertyId: string;
  let adminId: string;
  let deskId: string;
  let chargeCodeId: string;

  const setAddon = (module: "EXCURSIONS" | "SPA", enabled: boolean, ent = enterpriseId) =>
    prisma.enterpriseAddonAccess.upsert({
      where: { enterpriseId_module: { enterpriseId: ent, module } },
      update: { enabled },
      create: { enterpriseId: ent, module, enabled },
    });

  const createKey = (body: Record<string, unknown>) =>
    asUser(adminId, () => hubKeysRoute.POST(json("POST", { name: `site-${uniq()}`, propertyId: propertyId, ...body })));

  const modulesFor = async (key: string) => {
    const res = await propertyRoute.GET(api(`/properties/${propertyId}`, key), params({ propertyId }));
    expect(res.status).toBe(200);
    return (await res.json()).property.modules;
  };

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const passwordHash = await bcrypt.hash("password123", 10);

    enterpriseId = (await prisma.enterprise.create({ data: { name: "Scopes", slug: `test-scp-${uniq()}`, type: "STANDARD" } })).id;
    otherEnterpriseId = (await prisma.enterprise.create({ data: { name: "Other", slug: `test-scp-o-${uniq()}`, type: "STANDARD" } })).id;
    propertyId = (
      await prisma.property.create({
        data: {
          enterpriseId, name: "Scope Resort", code: `SCP-${uniq()}`, legalName: "Scope LLC",
          defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
        },
      })
    ).id;
    adminId = (
      await prisma.user.create({
        data: {
          enterpriseId, email: `scp-admin-${uniq()}@test.local`, passwordHash, firstName: "Admin", lastName: "Scp",
          roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
        },
      })
    ).id;
    // Front Desk has no INTEGRATIONS rights and no Hub — it must not manage online sales.
    deskId = (
      await prisma.user.create({
        data: {
          enterpriseId, email: `scp-desk-${uniq()}@test.local`, passwordHash, firstName: "Desk", lastName: "Scp",
          roles: { create: { roleId: roleIds["Front Desk"] } }, scope: "ENTERPRISE",
        },
      })
    ).id;
    chargeCodeId = (await customChargeCode({ propertyId }, { code: "SCPEXC", description: "Scope Excursion" })).id;
  });

  // ---------------------------------------------------------------------------------
  describe("key scopes", () => {
    it("a key made without choosing is a rooms key, exactly as before scopes existed", async () => {
      const res = await createKey({});
      expect(res.status).toBe(201);
      expect((await res.json()).row.scopes).toEqual(["ROOMS"]);
    });

    it("an add-on scope can only be granted while the enterprise has the add-on", async () => {
      await setAddon("SPA", false);
      const refused = await createKey({ scopes: ["ROOMS", "SPA"] });
      expect(refused.status).toBe(403);

      await setAddon("SPA", true);
      const list = await (await asUser(adminId, () => hubKeysRoute.GET())).json();
      expect(list.availableScopes).toContain("SPA");
      const ok = await createKey({ scopes: ["SPA", "ROOMS"] });
      expect(ok.status).toBe(201);
      expect((await ok.json()).row.scopes).toEqual(["ROOMS", "SPA"]); // canonical order
    });

    it("editing keeps a scope whose add-on was since switched off, but can't newly add one", async () => {
      await setAddon("SPA", true);
      await setAddon("EXCURSIONS", false);
      const created = await (await createKey({ scopes: ["ROOMS", "SPA"] })).json();
      await setAddon("SPA", false);

      const rename = await asUser(adminId, () =>
        hubKeyRoute.PATCH(json("PATCH", { name: "renamed", scopes: ["ROOMS", "SPA"] }), params({ id: created.row.id }))
      );
      expect(rename.status).toBe(200);
      expect((await rename.json()).scopes).toEqual(["ROOMS", "SPA"]);

      const addExcursions = await asUser(adminId, () =>
        hubKeyRoute.PATCH(json("PATCH", { scopes: ["ROOMS", "SPA", "EXCURSIONS"] }), params({ id: created.row.id }))
      );
      expect(addExcursions.status).toBe(403);
      await setAddon("SPA", true);
    });

    it("rooms endpoints refuse a key without the ROOMS scope with 403 SCOPE_NOT_GRANTED", async () => {
      await setAddon("SPA", true);
      const { key } = await (await createKey({ scopes: ["SPA"] })).json();
      const res = await availabilityRoute.GET(
        api(`/properties/${propertyId}/availability?from=2026-01-10&to=2026-01-12`, key),
        params({ propertyId })
      );
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("SCOPE_NOT_GRANTED");
      // …but the property page itself is shared by every module.
      const modules = await modulesFor(key);
      expect(modules.rooms).toMatchObject({ enabled: false, code: "SCOPE_NOT_GRANTED" });
    });
  });

  // ---------------------------------------------------------------------------------
  describe("module status", () => {
    it("reports each blocker in turn, and re-checks the add-on live on every request", async () => {
      await setAddon("EXCURSIONS", true);
      const { key } = await (await createKey({ scopes: ["ROOMS", "EXCURSIONS"] })).json();
      await setAddon("EXCURSIONS", false);

      expect((await modulesFor(key)).excursions.code).toBe("ADDON_NOT_ENABLED");
      expect((await modulesFor(key)).spa.code).toBe("SCOPE_NOT_GRANTED");

      await setAddon("EXCURSIONS", true);
      expect((await modulesFor(key)).excursions.code).toBe("NOT_SOLD_ONLINE");

      const on = await asUser(adminId, () =>
        hubActivityRoute.PATCH(json("PATCH", { module: "EXCURSIONS", enabled: true }), params({ propertyId }))
      );
      expect(on.status).toBe(200);
      expect((await modulesFor(key)).excursions.code).toBe("NO_OUTLET");

      const outlet = await prisma.outlet.create({ data: { propertyId, name: "Tours", code: `T${uniq().slice(-4)}`, outletType: "EXCURSION" } });
      await setPropertySettings(propertyId, { excursionOutletId: outlet.id });
      expect((await modulesFor(key)).excursions.code).toBe("NOTHING_PUBLISHED");

      const type = await prisma.excursionType.create({
        data: { propertyId, code: `SN${uniq().slice(-4)}`, name: "Snorkel", chargeCodeId },
      });
      const publish = await asUser(adminId, () =>
        hubItemRoute.PATCH(json("PATCH", { module: "EXCURSIONS", publishOnline: true }), params({ id: type.id }))
      );
      expect(publish.status).toBe(200);
      expect((await modulesFor(key)).excursions).toEqual({ enabled: true, code: null, reason: null });

      // Osta switches the add-on off: the very next request says so.
      await setAddon("EXCURSIONS", false);
      expect((await modulesFor(key)).excursions.code).toBe("ADDON_NOT_ENABLED");
      await setAddon("EXCURSIONS", true);
    });
  });

  // ---------------------------------------------------------------------------------
  describe("Hub online settings", () => {
    it("lists only the modules the enterprise has, with defaults for unconfigured properties", async () => {
      await setAddon("EXCURSIONS", true);
      await setAddon("SPA", false);
      const data = await (await asUser(adminId, () => hubActivityRoute.GET(new Request("http://localhost"), params({ propertyId })))).json();
      expect(data.modules).toEqual(["EXCURSIONS"]);
      const row = data.properties.find((p: { property: { id: string } }) => p.property.id === propertyId);
      expect(row.modules.map((m: { module: string }) => m.module)).toEqual(["EXCURSIONS"]);
      await setAddon("SPA", true);
    });

    it("validates ranges and refuses a payment method from another enterprise", async () => {
      const badHold = await asUser(adminId, () =>
        hubActivityRoute.PATCH(json("PATCH", { module: "EXCURSIONS", holdMinutes: 2 }), params({ propertyId }))
      );
      expect(badHold.status).toBe(403);

      // Payment methods are per property — this one belongs to a property of another enterprise.
      const foreignProperty = await prisma.property.create({
        data: { enterpriseId: otherEnterpriseId, name: "Foreign", code: `FPM-${uniq()}`, legalName: "Foreign LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" },
      });
      const foreign = await prisma.paymentMethod.create({ data: { enterpriseId: otherEnterpriseId, propertyId: foreignProperty.id, name: "Foreign card", type: "CARD" } });
      const badMethod = await asUser(adminId, () =>
        hubActivityRoute.PATCH(json("PATCH", { module: "EXCURSIONS", onlinePaymentMethodId: foreign.id }), params({ propertyId }))
      );
      expect(badMethod.status).toBe(403);

      const own = await prisma.paymentMethod.create({ data: { enterpriseId, propertyId, name: "Online card", type: "CARD" } });
      const ok = await asUser(adminId, () =>
        hubActivityRoute.PATCH(
          json("PATCH", { module: "EXCURSIONS", onlinePaymentMethodId: own.id, holdMinutes: 15, leadHours: 4, maxPartySize: 8, policies: "  Bring a towel  " }),
          params({ propertyId })
        )
      );
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ onlinePaymentMethodId: own.id, holdMinutes: 15, leadHours: 4, maxPartySize: 8, policies: "Bring a towel" });
    });

    it("a spa treatment closed to walk-ins can't be published — online guests book as walk-ins", async () => {
      await setAddon("SPA", true);
      const category = await prisma.spaTreatmentCategory.create({ data: { propertyId, name: `Cat ${uniq()}` } });
      const treatment = await prisma.spaTreatment.create({
        data: { propertyId, categoryId: category.id, name: "Residents only", defaultDurationMinutes: 60, chargeCodeId, allowWalkIn: false },
      });
      const res = await asUser(adminId, () =>
        hubItemRoute.PATCH(json("PATCH", { module: "SPA", publishOnline: true }), params({ id: treatment.id }))
      );
      expect(res.status).toBe(403);
      expect((await prisma.spaTreatment.findUniqueOrThrow({ where: { id: treatment.id } })).publishOnline).toBe(false);
    });

    it("stores guest-facing copy, refusing a non-http photo address", async () => {
      const type = await prisma.excursionType.create({ data: { propertyId, code: `IS${uniq().slice(-4)}`, name: "Island hop", chargeCodeId } });
      const bad = await asUser(adminId, () =>
        hubItemRoute.PATCH(json("PATCH", { module: "EXCURSIONS", imageUrls: ["javascript:alert(1)"] }), params({ id: type.id }))
      );
      expect(bad.status).toBe(403);
      const ok = await asUser(adminId, () =>
        hubItemRoute.PATCH(
          json("PATCH", { module: "EXCURSIONS", publicDescription: "Three islands", imageUrls: ["https://cdn.example.com/a.jpg", " "], inclusions: "Lunch" }),
          params({ id: type.id })
        )
      );
      expect(ok.status).toBe(200);
      expect((await ok.json()).item).toMatchObject({ publicDescription: "Three islands", imageUrls: ["https://cdn.example.com/a.jpg"], inclusions: "Lunch" });
    });

    it("another enterprise's item answers not found, and the desk can't manage online sales", async () => {
      const otherProperty = await prisma.property.create({
        data: {
          enterpriseId: otherEnterpriseId, name: "Other", code: `OTH-${uniq()}`, legalName: "Other LLC",
          defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
        },
      });
      const otherCode = await customChargeCode({ propertyId: otherProperty.id }, { code: "OTHEXC" });
      const foreignType = await prisma.excursionType.create({ data: { propertyId: otherProperty.id, code: "FOR", name: "Foreign", chargeCodeId: otherCode.id } });
      const foreign = await asUser(adminId, () =>
        hubItemRoute.PATCH(json("PATCH", { module: "EXCURSIONS", publishOnline: true }), params({ id: foreignType.id }))
      );
      expect(foreign.status).toBe(404);
      expect((await prisma.excursionType.findUniqueOrThrow({ where: { id: foreignType.id } })).publishOnline).toBe(false);

      const desk = await asUser(deskId, () =>
        hubActivityRoute.PATCH(json("PATCH", { module: "EXCURSIONS", enabled: false }), params({ propertyId }))
      );
      expect(desk.status).toBe(403);
    });
  });
});
