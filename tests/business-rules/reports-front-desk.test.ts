import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { prisma } = await import("@/lib/db");
const { getReport } = await import("@/lib/reports/registry");
const { renderReport } = await import("@/lib/reports/engine");
const { renderCsv } = await import("@/lib/reports/render/csv");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const BIZ = new Date(Date.UTC(2026, 4, 12)); // 2026-05-12
const fakeCtx: any = { userId: "u", enterpriseId: "e", scope: "PROPERTY" };
const branding = { propertyName: "P", enterpriseName: "E", currency: "USD", brandColor: null, generatedBy: "Tester", generatedAt: BIZ };

async function run(key: string, params: Record<string, unknown>, propertyId: string) {
  const def = getReport(key)!;
  return def.run({ ctx: fakeCtx, propertyId, params });
}

describe("Reporting engine — Front Desk reports + renderers", () => {
  let propertyId: string;
  let rtId: string;

  beforeAll(async () => {
    const enterprise = await prisma.enterprise.create({ data: { name: "Rep", slug: `test-rep-${uniq()}`, type: "STANDARD" } });
    const property = await prisma.property.create({ data: { enterpriseId: enterprise.id, name: "Rep Prop", code: `RP-${uniq()}`, legalName: "RP LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", businessDate: BIZ } });
    propertyId = property.id;
    rtId = (await prisma.roomType.create({ data: { propertyId, name: "Deluxe", code: "DLX", maxOccupancy: 2 } })).id;
    const room = await prisma.room.create({ data: { propertyId, roomTypeId: rtId, roomNumber: "301", status: "CLEAN" } });
    const ratePlan = await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "BAR" } });
    // Guest with a birthday on the arrival date (different year).
    const guest = await prisma.profile.create({ data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: "Bea", lastName: "Day", dateOfBirth: new Date(Date.UTC(1990, 4, 12)), vipLevel: "GOLD" } });

    await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `RP-${uniq()}`, primaryGuestId: guest.upid,
        checkInDate: BIZ, checkOutDate: new Date(BIZ.getTime() + 3 * 86_400_000), status: "RESERVED", adults: 2, children: 1,
        assignments: { create: { roomTypeId: rtId, roomId: room.id, ratePlanId: ratePlan.id, overrideRate: 250, startDate: BIZ, endDate: new Date(BIZ.getTime() + 3 * 86_400_000) } },
      },
    });
  });

  it("Arrival Report lists the day's expected arrivals with VIP + rate", async () => {
    const res = await run("fd-arrivals", { date: BIZ }, propertyId);
    expect(res.rows).toHaveLength(1);
    const row = res.rows![0];
    expect(row.guest).toBe("Bea Day");
    expect(row.vip).toBe("VIP");
    expect(row.roomType).toBe("Deluxe");
    expect(row.rate).toBe(250);
    expect(row.nights).toBe(3);
    expect(row.status).toBe("Expected");
  });

  it("Guest Event Calendar surfaces the birthday during the stay window", async () => {
    const res = await run("fd-guest-events", { range: { from: BIZ, to: new Date(BIZ.getTime() + 2 * 86_400_000) } }, propertyId);
    expect(res.rows!.some((r) => r.event === "Birthday" && r.guest === "Bea Day")).toBe(true);
  });

  it("renders a report to PDF, XLSX, and CSV", async () => {
    const res = await run("fd-arrivals", { date: BIZ }, propertyId);
    const pdf = await renderReport("fd-arrivals", res, branding as any, "pdf");
    expect(pdf.contentType).toBe("application/pdf");
    expect(pdf.body.length).toBeGreaterThan(500);
    expect(pdf.filename.endsWith(".pdf")).toBe(true);

    const xlsx = await renderReport("fd-arrivals", res, branding as any, "xlsx");
    expect(xlsx.body.length).toBeGreaterThan(500);
    expect(xlsx.filename.endsWith(".xlsx")).toBe(true);

    const csv = renderCsv(res);
    expect(csv).toContain("Arrival Report");
    expect(csv).toContain("Bea Day");
  });
});
