import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import bcrypt from "bcryptjs";

// Same in-memory cookie-jar fake as tests/scope.test.ts.
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

// The confirmation email route must never make a real SMTP connection in tests — mock
// the shared mailer and drive its behavior per-test via this mutable holder.
const mailerMock = {
  sendMail: vi.fn(),
};
vi.mock("@/lib/mailer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mailer")>("@/lib/mailer");
  return {
    ...actual,
    sendMail: (...args: unknown[]) => mailerMock.sendMail(...args),
  };
});

const { prisma } = await import("@/lib/db");
const { createSession, destroySession } = await import("@/lib/auth");
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");
const { SmtpNotConfiguredError } = await import("@/lib/mailer");

const dataRoute = await import("@/app/api/reservations/[id]/confirmation-letter-data/route");
const sendRoute = await import("@/app/api/reservations/[id]/send-confirmation/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

describe("Confirmation Letter: tenant isolation + email sending", () => {
  let propertyAId: string;
  let propertyBId: string;
  let adminAId: string;
  let adminBId: string;
  let roomTypeAId: string;
  let ratePlanAId: string;
  let reservationAId: string;
  let reservationNoEmailId: string;

  beforeEach(() => {
    mailerMock.sendMail.mockReset();
  });

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterpriseA = await prisma.enterprise.upsert({
      where: { slug: "test-confletter-enterprise-a" },
      update: {},
      create: { name: "ConfLetter Enterprise A", slug: "test-confletter-enterprise-a", type: "STANDARD" },
    });
    const enterpriseB = await prisma.enterprise.upsert({
      where: { slug: "test-confletter-enterprise-b" },
      update: {},
      create: { name: "ConfLetter Enterprise B", slug: "test-confletter-enterprise-b", type: "STANDARD" },
    });

    const propertyA = await prisma.property.create({
      data: {
        enterpriseId: enterpriseA.id, name: "ConfLetter Property A", code: `CLPA-${Date.now()}`,
        legalName: "Property A LLC", defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyAId = propertyA.id;

    const propertyB = await prisma.property.create({
      data: {
        enterpriseId: enterpriseB.id, name: "ConfLetter Property B", code: `CLPB-${Date.now()}`,
        legalName: "Property B LLC", defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyBId = propertyB.id;

    const roomTypeA = await prisma.roomType.create({
      data: { propertyId: propertyAId, name: "Deluxe", code: "DLX", maxOccupancy: 2 },
    });
    roomTypeAId = roomTypeA.id;

    const ratePlanA = await prisma.ratePlan.create({
      data: { propertyId: propertyAId, code: "BAR", name: "Best Available Rate" },
    });
    ratePlanAId = ratePlanA.id;

    const passwordHash = await bcrypt.hash("password123", 10);
    const adminA = await prisma.user.create({
      data: {
        enterpriseId: enterpriseA.id, email: `confletter-admin-a-${Date.now()}@test.local`, passwordHash,
        firstName: "Admin", lastName: "A", roleId: roleIds["Admin"], scope: "ENTERPRISE",
      },
    });
    adminAId = adminA.id;

    const adminB = await prisma.user.create({
      data: {
        enterpriseId: enterpriseB.id, email: `confletter-admin-b-${Date.now()}@test.local`, passwordHash,
        firstName: "Admin", lastName: "B", roleId: roleIds["Admin"], scope: "ENTERPRISE",
      },
    });
    adminBId = adminB.id;

    const guestWithEmail = await prisma.profile.create({
      data: {
        enterpriseId: enterpriseA.id, profileType: "GUEST", firstName: "Guest", lastName: "WithEmail",
        contacts: { create: { email: "guest@example.com", isPrimary: true } },
      },
    });

    const reservationA = await prisma.reservation.create({
      data: {
        confirmationNo: `CLA-${Date.now()}`,
        propertyId: propertyAId,
        primaryGuestId: guestWithEmail.upid,
        checkInDate: new Date("2026-09-01"),
        checkOutDate: new Date("2026-09-03"),
        remarks: "Honeymoon — high floor requested",
        assignments: {
          create: { roomTypeId: roomTypeAId, ratePlanId: ratePlanAId, startDate: new Date("2026-09-01"), endDate: new Date("2026-09-03") },
        },
      },
    });
    reservationAId = reservationA.id;

    const guestNoEmail = await prisma.profile.create({
      data: { enterpriseId: enterpriseA.id, profileType: "GUEST", firstName: "Guest", lastName: "NoEmail" },
    });

    const reservationNoEmail = await prisma.reservation.create({
      data: {
        confirmationNo: `CLN-${Date.now()}`,
        propertyId: propertyAId,
        primaryGuestId: guestNoEmail.upid,
        checkInDate: new Date("2026-09-05"),
        checkOutDate: new Date("2026-09-06"),
        assignments: {
          create: { roomTypeId: roomTypeAId, ratePlanId: ratePlanAId, startDate: new Date("2026-09-05"), endDate: new Date("2026-09-06") },
        },
      },
    });
    reservationNoEmailId = reservationNoEmail.id;
  });

  it("GET confirmation-letter-data returns the reservation + settings for the owning enterprise", async () => {
    const res = await asUser(adminAId, () =>
      dataRoute.GET(new Request(`http://localhost/api/reservations/${reservationAId}/confirmation-letter-data`), {
        params: Promise.resolve({ id: reservationAId }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reservation.id).toBe(reservationAId);
    expect(body.reservation.remarks).toBe("Honeymoon — high floor requested");
    expect(body.settings).toBeTruthy();
  });

  it("GET confirmation-letter-data 403s when the reservation belongs to a different enterprise", async () => {
    const res = await asUser(adminBId, () =>
      dataRoute.GET(new Request(`http://localhost/api/reservations/${reservationAId}/confirmation-letter-data`), {
        params: Promise.resolve({ id: reservationAId }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("POST send-confirmation 400s when the primary guest has no email on file", async () => {
    const res = await asUser(adminAId, () =>
      sendRoute.POST(new Request(`http://localhost/api/reservations/${reservationNoEmailId}/send-confirmation`, { method: "POST" }), {
        params: Promise.resolve({ id: reservationNoEmailId }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no email address/i);
    expect(mailerMock.sendMail).not.toHaveBeenCalled();
  });

  it("POST send-confirmation 403s when the reservation belongs to a different enterprise", async () => {
    const res = await asUser(adminBId, () =>
      sendRoute.POST(new Request(`http://localhost/api/reservations/${reservationAId}/send-confirmation`, { method: "POST" }), {
        params: Promise.resolve({ id: reservationAId }),
      })
    );
    expect(res.status).toBe(403);
    expect(mailerMock.sendMail).not.toHaveBeenCalled();
  });

  it("POST send-confirmation 400s cleanly when SMTP is not configured", async () => {
    mailerMock.sendMail.mockRejectedValueOnce(new SmtpNotConfiguredError());
    const res = await asUser(adminAId, () =>
      sendRoute.POST(new Request(`http://localhost/api/reservations/${reservationAId}/send-confirmation`, { method: "POST" }), {
        params: Promise.resolve({ id: reservationAId }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/SMTP is not configured/i);
  });

  it("POST send-confirmation sends to the primary guest's email and returns success", async () => {
    mailerMock.sendMail.mockResolvedValueOnce(undefined);
    const res = await asUser(adminAId, () =>
      sendRoute.POST(new Request(`http://localhost/api/reservations/${reservationAId}/send-confirmation`, { method: "POST" }), {
        params: Promise.resolve({ id: reservationAId }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.sentTo).toBe("guest@example.com");
    expect(mailerMock.sendMail).toHaveBeenCalledTimes(1);
    const callArgs = mailerMock.sendMail.mock.calls[0][0];
    expect(callArgs.to).toBe("guest@example.com");
    expect(callArgs.html).toContain("Honeymoon");
  });

  it("POST send-confirmation returns 502 when sendMail fails unexpectedly", async () => {
    mailerMock.sendMail.mockRejectedValueOnce(new Error("connection refused"));
    const res = await asUser(adminAId, () =>
      sendRoute.POST(new Request(`http://localhost/api/reservations/${reservationAId}/send-confirmation`, { method: "POST" }), {
        params: Promise.resolve({ id: reservationAId }),
      })
    );
    expect(res.status).toBe(502);
  });
});
