import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";
import { addMinutesToTime, computeAppointmentTotal, rateForDate, validateRateRanges } from "@/lib/spa";

// --- Pure-function unit tests (no DB, no session) ---

describe("spa: pure helpers", () => {
  it("addMinutesToTime adds (and subtracts) minutes with zero-padding", () => {
    expect(addMinutesToTime("09:00", 90)).toBe("10:30");
    expect(addMinutesToTime("09:05", -10)).toBe("08:55");
  });

  it("computeAppointmentTotal: PER_PERSON multiplies by party size, FLAT ignores it", () => {
    expect(computeAppointmentTotal({ price: 40 }, "PER_PERSON", 2)).toBe(80);
    expect(computeAppointmentTotal({ price: 150 }, "FLAT", 2)).toBe(150);
  });

  it("rateForDate picks the row covering the date, preferring none over a stale range", () => {
    const rates = [
      { effectiveFrom: new Date(2020, 0, 1), effectiveTo: new Date(2025, 11, 31), price: 10 },
      { effectiveFrom: new Date(2026, 0, 1), effectiveTo: null, price: 20 },
    ];
    expect(rateForDate(rates, new Date(2026, 6, 22))?.price).toBe(20);
    expect(rateForDate(rates, new Date(2019, 0, 1))).toBeNull();
  });

  it("validateRateRanges rejects overlap and accepts adjacent ranges", () => {
    expect(
      validateRateRanges([
        { effectiveFrom: new Date(2026, 0, 1), effectiveTo: new Date(2026, 5, 30) },
        { effectiveFrom: new Date(2026, 5, 1), effectiveTo: null },
      ])
    ).not.toBeNull();
    expect(
      validateRateRanges([
        { effectiveFrom: new Date(2026, 0, 1), effectiveTo: new Date(2026, 5, 30) },
        { effectiveFrom: new Date(2026, 6, 1), effectiveTo: null },
      ])
    ).toBeNull();
  });
});

// --- Route-level integration tests ---

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
const enterpriseAddonsRoute = await import("@/app/api/licenses/enterprise-addons/route");
const appointmentsRoute = await import("@/app/api/spa/appointments/route");
const availabilityRoute = await import("@/app/api/spa/appointments/availability/route");
const therapistsForTreatmentRoute = await import("@/app/api/spa/treatments/[id]/therapists/route");
const posSearchRoute = await import("@/app/api/pos/search/route");
const walkInFolioRoute = await import("@/app/api/folios/walk-in/route");
const { customChargeCode, chargeCode, subgroupId, ensureChart } = await import("../helpers/charge-codes");

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
// UTC-explicit on purpose — a local-midnight construction (setHours(0,0,0,0)) would
// land on the wrong calendar day once serialized through toISOString() on a
// non-UTC test machine, the same timezone bug class EXCURSIONS_PLAN.md's Phase 5
// already documented hitting once for real on this exact codebase.
const day = (offsetDays: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays));
};
const dayStr = (d: Date) => d.toISOString().slice(0, 10);

const bookAppointment = (payload: Record<string, unknown>) =>
  appointmentsRoute.POST(
    new Request("http://localhost/api/spa/appointments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
  );

const openWalkInFolio = (payload: Record<string, unknown>) =>
  walkInFolioRoute.POST(
    new Request("http://localhost/api/folios/walk-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
  );

describe("Spa booking: business rules", () => {
  let ostaAdminId: string;
  let enterpriseId: string;
  let propertyId: string;
  let adminId: string;
  let chargeCodeId: string;
  let categoryId: string;
  let treatmentId: string;
  let coupleTreatmentId: string;
  let therapistAId: string;
  let therapistBId: string;
  let roomId: string;
  let coupleRoomId: string;

  const makeReservation = async () => {
    const guest = await prisma.profile.create({
      data: { enterpriseId, profileType: "GUEST", firstName: "Spa", lastName: `Guest-${uniq()}` },
    });
    const reservation = await prisma.reservation.create({
      data: {
        propertyId, primaryGuestId: guest.upid, confirmationNo: `SPA-${uniq()}`,
        checkInDate: day(-1), checkOutDate: day(30), status: "IN_HOUSE",
        folios: { create: [{ propertyId, folioNumber: 1 }] },
      },
      include: { folios: true },
    });
    return { reservationId: reservation.id, folioId: reservation.folios[0].id };
  };

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const passwordHash = await bcrypt.hash("password123", 10);

    const ostaAdmin = await prisma.user.create({
      data: {
        enterpriseId: osta.id, email: `spa-br-osta-${uniq()}@test.local`, passwordHash,
        firstName: "Osta", lastName: "Admin", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
      },
    });
    ostaAdminId = ostaAdmin.id;

    const enterprise = await prisma.enterprise.create({
      data: { name: "Spa BR", slug: `test-spa-br-${uniq()}`, type: "STANDARD" },
    });
    enterpriseId = enterprise.id;

    const property = await prisma.property.create({
      data: {
        enterpriseId, name: "BR Property", code: `SBR-${uniq()}`, legalName: "BR LLC",
        defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyId = property.id;

    await asUser(ostaAdminId, () =>
      enterpriseAddonsRoute.PATCH(
        new Request("http://localhost/api/licenses/enterprise-addons", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enterpriseId, module: "SPA", enabled: true }),
        })
      )
    );

    const chargeCode = await customChargeCode(enterpriseId, { code: "SPA", description: "Spa Charge" });
    chargeCodeId = chargeCode.id;

    // Hub-wide Spa Outlet link — AT_BOOKING posting is refused without one (owner rule
    // 2026-07-30), so every appointment test needs it wired.
    const spaOutlet = await prisma.outlet.create({ data: { propertyId, name: "BR Spa", code: "BRSP", outletType: "SPA" } });
    await prisma.enterpriseSettings.upsert({
      where: { enterpriseId },
      update: { spaOutletId: spaOutlet.id },
      create: { enterpriseId, resConfirmPrefix: "", resConfirmLength: 6, tgstEnabled: false, serviceChargeEnabled: false, greenTaxEnabled: false, spaOutletId: spaOutlet.id },
    });

    const admin = await prisma.user.create({
      data: {
        enterpriseId, email: `spa-br-admin-${uniq()}@test.local`, passwordHash,
        firstName: "Admin", lastName: "BR", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
      },
    });
    adminId = admin.id;

    const category = await prisma.spaTreatmentCategory.create({ data: { propertyId, name: "Massage" } });
    categoryId = category.id;

    const treatment = await prisma.spaTreatment.create({
      data: {
        propertyId, categoryId, name: "Swedish Massage", defaultDurationMinutes: 60,
        preparationBufferMinutes: 10, cleanupBufferMinutes: 15, chargeCodeId,
        rates: { create: [{ price: 80, effectiveFrom: new Date(2020, 0, 1) }] },
      },
    });
    treatmentId = treatment.id;

    const coupleTreatment = await prisma.spaTreatment.create({
      data: {
        propertyId, categoryId, name: "Couple Massage", defaultDurationMinutes: 60,
        cleanupBufferMinutes: 15, chargeCodeId, maxParticipants: 2, pricingMode: "FLAT",
        rates: { create: [{ price: 150, effectiveFrom: new Date(2020, 0, 1) }] },
      },
    });
    coupleTreatmentId = coupleTreatment.id;

    const therapistA = await prisma.spaTherapist.create({ data: { propertyId, displayName: "Therapist A" } });
    therapistAId = therapistA.id;
    const therapistB = await prisma.spaTherapist.create({ data: { propertyId, displayName: "Therapist B" } });
    therapistBId = therapistB.id;

    await prisma.spaTherapistTreatment.createMany({
      data: [
        { therapistId: therapistAId, treatmentId, qualified: true },
        { therapistId: therapistBId, treatmentId, qualified: true },
        { therapistId: therapistAId, treatmentId: coupleTreatmentId, qualified: true },
        { therapistId: therapistBId, treatmentId: coupleTreatmentId, qualified: true },
      ],
    });

    // Both therapists work every day, 08:00-20:00, effective from well in the past.
    await prisma.spaTherapistSchedule.createMany({
      data: Array.from({ length: 7 }, (_, dow) => [
        { therapistId: therapistAId, dayOfWeek: dow, startTime: "08:00", endTime: "20:00", effectiveFrom: new Date(2020, 0, 1) },
        { therapistId: therapistBId, dayOfWeek: dow, startTime: "08:00", endTime: "20:00", effectiveFrom: new Date(2020, 0, 1) },
      ]).flat(),
    });

    const room = await prisma.spaRoom.create({ data: { propertyId, name: "Room 1", capacity: 1 } });
    roomId = room.id;
    const coupleRoom = await prisma.spaRoom.create({ data: { propertyId, name: "Couple Room", capacity: 2 } });
    coupleRoomId = coupleRoom.id;
  });

  it("books an in-house appointment, auto-assigns therapist+room, and posts a folio charge", async () => {
    const { reservationId, folioId } = await makeReservation();
    const res = await asUser(adminId, () =>
      bookAppointment({
        propertyId, treatmentId, appointmentDate: dayStr(day(3)), startTime: "10:00",
        participants: [{ reservationId }],
      })
    );
    expect(res.status).toBe(201);
    const appt = await res.json();
    expect(appt.roomId).toBeTruthy();
    expect(appt.participants).toHaveLength(1);
    expect(appt.participants[0].therapistId).toBeTruthy();
    expect(appt.priceSnapshot).toBe(80);
    expect(appt.paymentStatus).toBe("POSTED_TO_FOLIO");
    expect(appt.folioLineItemId).toBeTruthy();

    const lineItem = await prisma.folioLineItem.findUnique({ where: { id: appt.folioLineItemId } });
    expect(lineItem?.folioId).toBe(folioId);
    expect(lineItem?.amount).toBeCloseTo(80, 2);
    // A7: the charge is attributed to an open cashier shift for this property, so it
    // shows in the drawer/EOD reconciliation (previously shiftId was null).
    expect(lineItem?.shiftId).toBeTruthy();
    const shift = await prisma.cashierShift.findUnique({ where: { id: lineItem!.shiftId! } });
    expect(shift?.propertyId).toBe(propertyId);
  });

  it("rejects a second booking when the only qualified therapist is already booked over the requested time", async () => {
    const soloTreatment = await prisma.spaTreatment.create({
      data: {
        propertyId, categoryId, name: `Solo-${uniq()}`, defaultDurationMinutes: 60, cleanupBufferMinutes: 0,
        chargeCodeId, rates: { create: [{ price: 50, effectiveFrom: new Date(2020, 0, 1) }] },
      },
    });
    await prisma.spaTherapistTreatment.create({ data: { therapistId: therapistAId, treatmentId: soloTreatment.id, qualified: true } });

    const first = await makeReservation();
    const res1 = await asUser(adminId, () =>
      bookAppointment({
        propertyId, treatmentId: soloTreatment.id, appointmentDate: dayStr(day(4)), startTime: "11:00",
        participants: [{ reservationId: first.reservationId, therapistId: therapistAId }],
      })
    );
    expect(res1.status).toBe(201);

    const second = await makeReservation();
    const res2 = await asUser(adminId, () =>
      bookAppointment({
        propertyId, treatmentId: soloTreatment.id, appointmentDate: dayStr(day(4)), startTime: "11:30",
        participants: [{ reservationId: second.reservationId }],
      })
    );
    expect(res2.status).toBe(400);
    const body2 = await res2.json();
    expect(body2.error).toMatch(/no therapist/i);
  });

  it("rejects a second booking when the only compatible room is already booked over the requested time", async () => {
    const soloRoomTreatment = await prisma.spaTreatment.create({
      data: {
        propertyId, categoryId, name: `SoloRoom-${uniq()}`, defaultDurationMinutes: 60, cleanupBufferMinutes: 0,
        chargeCodeId, rates: { create: [{ price: 50, effectiveFrom: new Date(2020, 0, 1) }] },
      },
    });
    await prisma.spaTherapistTreatment.createMany({
      data: [
        { therapistId: therapistAId, treatmentId: soloRoomTreatment.id, qualified: true },
        { therapistId: therapistBId, treatmentId: soloRoomTreatment.id, qualified: true },
      ],
    });
    await prisma.spaTreatmentRoom.create({ data: { treatmentId: soloRoomTreatment.id, roomId } });

    const first = await makeReservation();
    const res1 = await asUser(adminId, () =>
      bookAppointment({
        propertyId, treatmentId: soloRoomTreatment.id, appointmentDate: dayStr(day(5)), startTime: "13:00",
        participants: [{ reservationId: first.reservationId }],
      })
    );
    expect(res1.status).toBe(201);

    const second = await makeReservation();
    const res2 = await asUser(adminId, () =>
      bookAppointment({
        propertyId, treatmentId: soloRoomTreatment.id, appointmentDate: dayStr(day(5)), startTime: "13:30",
        participants: [{ reservationId: second.reservationId }],
      })
    );
    expect(res2.status).toBe(400);
    const body2 = await res2.json();
    expect(body2.error).toMatch(/no room/i);
  });

  it("a couple treatment assigns two distinct therapists sharing one couple-capable room, priced flat", async () => {
    const first = await makeReservation();
    const second = await makeReservation();
    const res = await asUser(adminId, () =>
      bookAppointment({
        propertyId, treatmentId: coupleTreatmentId, appointmentDate: dayStr(day(6)), startTime: "10:00",
        participants: [{ reservationId: first.reservationId }, { reservationId: second.reservationId }],
      })
    );
    expect(res.status).toBe(201);
    const appt = await res.json();
    expect(appt.partySize).toBe(2);
    expect(appt.roomId).toBe(coupleRoomId);
    const therapistIds = appt.participants.map((p: { therapistId: string }) => p.therapistId);
    expect(new Set(therapistIds).size).toBe(2);
    expect(appt.priceSnapshot).toBe(150);
  });

  it("concurrency: two simultaneous bookings for the same only-available therapist — exactly one succeeds", async () => {
    const raceTreatment = await prisma.spaTreatment.create({
      data: {
        propertyId, categoryId, name: `Race-${uniq()}`, defaultDurationMinutes: 60, cleanupBufferMinutes: 0,
        chargeCodeId, rates: { create: [{ price: 50, effectiveFrom: new Date(2020, 0, 1) }] },
      },
    });
    await prisma.spaTherapistTreatment.create({ data: { therapistId: therapistAId, treatmentId: raceTreatment.id, qualified: true } });

    const [a, b] = await Promise.all([makeReservation(), makeReservation()]);

    // Both requests share one already-established session (a single already-logged-in
    // staff member submitting from two browser tabs) — the test harness's asUser()
    // helper clears/re-sets a shared cookie jar per call and isn't safe to run two of
    // concurrently, but the resource-lock guarantee under test lives entirely in the
    // route/business-logic layer below the auth check, not in the auth mock itself.
    cookieJar.clear();
    await createSession(adminId);
    try {
      const [res1, res2] = await Promise.all([
        bookAppointment({
          propertyId, treatmentId: raceTreatment.id, appointmentDate: dayStr(day(7)), startTime: "15:00",
          participants: [{ reservationId: a.reservationId }],
        }),
        bookAppointment({
          propertyId, treatmentId: raceTreatment.id, appointmentDate: dayStr(day(7)), startTime: "15:00",
          participants: [{ reservationId: b.reservationId }],
        }),
      ]);
      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([201, 400]);

      const created = await prisma.spaAppointment.findMany({ where: { treatmentId: raceTreatment.id, appointmentDate: day(7) } });
      expect(created).toHaveLength(1);
    } finally {
      await destroySession();
    }
  });

  it("books a walk-in appointment against an already-open walk-in folio, and posts the charge there", async () => {
    const folioRes = await asUser(adminId, () =>
      openWalkInFolio({ propertyId, walkInGuestName: "Priya Walk-in", walkInGuestContact: "555-0100" })
    );
    expect(folioRes.status).toBe(201);
    const folio = await folioRes.json();

    const res = await asUser(adminId, () =>
      bookAppointment({
        propertyId, treatmentId, appointmentDate: dayStr(day(8)), startTime: "09:00",
        participants: [{ folioId: folio.id }],
      })
    );
    expect(res.status).toBe(201);
    const appt = await res.json();
    expect(appt.folioId).toBe(folio.id);
    expect(appt.participants[0].walkInGuestName).toBe("Priya Walk-in");
    expect(appt.participants[0].reservationId).toBeNull();

    const lineItem = await prisma.folioLineItem.findUnique({ where: { id: appt.folioLineItemId } });
    expect(lineItem?.folioId).toBe(folio.id);
  });

  it("rejects smuggling a reservation's own folio in as a walk-in folioId", async () => {
    const { folioId } = await makeReservation();
    const res = await asUser(adminId, () =>
      bookAppointment({
        propertyId, treatmentId, appointmentDate: dayStr(day(9)), startTime: "09:00",
        participants: [{ folioId }],
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/use reservationId instead/i);
  });

  it("rejects booking against an already-closed walk-in folio", async () => {
    const folioRes = await asUser(adminId, () =>
      openWalkInFolio({ propertyId, walkInGuestName: "Closed Bill Guest" })
    );
    const folio = await folioRes.json();
    await prisma.folio.update({ where: { id: folio.id }, data: { isClosed: true } });

    const res = await asUser(adminId, () =>
      bookAppointment({
        propertyId, treatmentId, appointmentDate: dayStr(day(9)), startTime: "10:00",
        participants: [{ folioId: folio.id }],
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already closed/i);
  });

  it("a couple treatment can bill a walk-in primary with a plain-name companion (no folio needed for the companion)", async () => {
    const folioRes = await asUser(adminId, () =>
      openWalkInFolio({ propertyId, walkInGuestName: "Walk-in Primary" })
    );
    const folio = await folioRes.json();

    const res = await asUser(adminId, () =>
      bookAppointment({
        propertyId, treatmentId: coupleTreatmentId, appointmentDate: dayStr(day(10)), startTime: "11:00",
        participants: [{ folioId: folio.id }, { walkInGuestName: "Walk-in Companion" }],
      })
    );
    expect(res.status).toBe(201);
    const appt = await res.json();
    expect(appt.participants).toHaveLength(2);
    expect(appt.participants[0].walkInGuestName).toBe("Walk-in Primary");
    expect(appt.participants[1].walkInGuestName).toBe("Walk-in Companion");
    expect(appt.folioId).toBe(folio.id);
    // Only one charge posted for the whole appointment — the companion never gets
    // their own folio or line item.
    const lineItems = await prisma.folioLineItem.findMany({ where: { folioId: folio.id } });
    expect(lineItems).toHaveLength(1);
  });

  it("lists still-open walk-in-billed appointments via openWalkIns=true", async () => {
    const folioRes = await asUser(adminId, () =>
      openWalkInFolio({ propertyId, walkInGuestName: "Listed Walk-in" })
    );
    const folio = await folioRes.json();
    const bookingRes = await asUser(adminId, () =>
      bookAppointment({
        propertyId, treatmentId, appointmentDate: dayStr(day(11)), startTime: "09:00",
        participants: [{ folioId: folio.id }],
      })
    );
    const appt = await bookingRes.json();

    const listRes = await asUser(adminId, () =>
      appointmentsRoute.GET(new Request(`http://localhost/api/spa/appointments?propertyId=${propertyId}&openWalkIns=true`))
    );
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.some((a: { id: string }) => a.id === appt.id)).toBe(true);

    // Closing the folio removes it from the open list.
    await prisma.folio.update({ where: { id: folio.id }, data: { isClosed: true } });
    const listRes2 = await asUser(adminId, () =>
      appointmentsRoute.GET(new Request(`http://localhost/api/spa/appointments?propertyId=${propertyId}&openWalkIns=true`))
    );
    const list2 = await listRes2.json();
    expect(list2.some((a: { id: string }) => a.id === appt.id)).toBe(false);
  });

  it("rejects booking a date that has already passed", async () => {
    // Regression test for a real bug found via live-testing: nothing previously
    // stopped a calendar date before the property's business date from being
    // booked, confirmed, and charged. yesterday() is UTC-explicit for the same
    // reason `day()` above is.
    const { reservationId } = await makeReservation();
    const now = new Date();
    const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
    const res = await asUser(adminId, () =>
      bookAppointment({
        propertyId, treatmentId, appointmentDate: dayStr(yesterday), startTime: "09:00",
        participants: [{ reservationId }],
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already passed/i);
  });

  it("a gender request is a hard filter, not a sort preference", async () => {
    const genderTreatment = await prisma.spaTreatment.create({
      data: {
        propertyId, categoryId, name: `Gender-${uniq()}`, defaultDurationMinutes: 60, cleanupBufferMinutes: 0,
        chargeCodeId, rates: { create: [{ price: 60, effectiveFrom: new Date(2020, 0, 1) }] },
      },
    });
    const female = await prisma.spaTherapist.create({ data: { propertyId, displayName: `Female-${uniq()}`, gender: "FEMALE" } });
    const male = await prisma.spaTherapist.create({ data: { propertyId, displayName: `Male-${uniq()}`, gender: "MALE" } });
    await prisma.spaTherapistTreatment.createMany({
      data: [
        { therapistId: female.id, treatmentId: genderTreatment.id, qualified: true },
        { therapistId: male.id, treatmentId: genderTreatment.id, qualified: true },
      ],
    });
    await prisma.spaTherapistSchedule.createMany({
      data: Array.from({ length: 7 }, (_, dow) => [
        { therapistId: female.id, dayOfWeek: dow, startTime: "08:00", endTime: "20:00", effectiveFrom: new Date(2020, 0, 1) },
        { therapistId: male.id, dayOfWeek: dow, startTime: "08:00", endTime: "20:00", effectiveFrom: new Date(2020, 0, 1) },
      ]).flat(),
    });
    // Dedicated rooms so this test's 3rd, expected-to-fail booking fails on the
    // THERAPIST constraint being tested, not because room supply ran out first.
    for (let i = 0; i < 3; i++) {
      const room = await prisma.spaRoom.create({ data: { propertyId, name: `Gender Room ${i}-${uniq()}`, capacity: 1 } });
      await prisma.spaTreatmentRoom.create({ data: { treatmentId: genderTreatment.id, roomId: room.id } });
    }

    const g1 = await makeReservation();
    const res1 = await asUser(adminId, () =>
      bookAppointment({
        propertyId, treatmentId: genderTreatment.id, appointmentDate: dayStr(day(20)), startTime: "09:00",
        participants: [{ reservationId: g1.reservationId, requestedGender: "FEMALE" }],
      })
    );
    expect(res1.status).toBe(201);
    const appt1 = await res1.json();
    expect(appt1.participants[0].therapistId).toBe(female.id);
    expect(appt1.participants[0].requestedGender).toBe("FEMALE");

    // Books out the male therapist at the exact same slot with a different request —
    // proves the filter actually scopes the candidate pool per request, not just
    // ranking within a shared pool.
    const g2 = await makeReservation();
    const res2 = await asUser(adminId, () =>
      bookAppointment({
        propertyId, treatmentId: genderTreatment.id, appointmentDate: dayStr(day(20)), startTime: "09:00",
        participants: [{ reservationId: g2.reservationId, requestedGender: "MALE" }],
      })
    );
    expect(res2.status).toBe(201);
    const appt2 = await res2.json();
    expect(appt2.participants[0].therapistId).toBe(male.id);

    // The only female is now busy — a third female request at the same slot must be
    // rejected, never silently handed the (free) male therapist instead.
    const g3 = await makeReservation();
    const res3 = await asUser(adminId, () =>
      bookAppointment({
        propertyId, treatmentId: genderTreatment.id, appointmentDate: dayStr(day(20)), startTime: "09:00",
        participants: [{ reservationId: g3.reservationId, requestedGender: "FEMALE" }],
      })
    );
    expect(res3.status).toBe(400);
    const body3 = await res3.json();
    expect(body3.error).toMatch(/no therapist/i);
  });

  it("a specific therapist request succeeds when free and is rejected — never silently reassigned — when unavailable", async () => {
    const namedTreatment = await prisma.spaTreatment.create({
      data: {
        propertyId, categoryId, name: `Named-${uniq()}`, defaultDurationMinutes: 60, cleanupBufferMinutes: 0,
        chargeCodeId, rates: { create: [{ price: 70, effectiveFrom: new Date(2020, 0, 1) }] },
      },
    });
    await prisma.spaTherapistTreatment.createMany({
      data: [
        { therapistId: therapistAId, treatmentId: namedTreatment.id, qualified: true },
        { therapistId: therapistBId, treatmentId: namedTreatment.id, qualified: true },
      ],
    });
    await prisma.spaTreatmentRoom.createMany({
      data: [{ treatmentId: namedTreatment.id, roomId }, { treatmentId: namedTreatment.id, roomId: coupleRoomId }],
    });

    const g1 = await makeReservation();
    const res1 = await asUser(adminId, () =>
      bookAppointment({
        propertyId, treatmentId: namedTreatment.id, appointmentDate: dayStr(day(21)), startTime: "09:00",
        participants: [{ reservationId: g1.reservationId, therapistId: therapistAId }],
      })
    );
    expect(res1.status).toBe(201);
    const appt1 = await res1.json();
    expect(appt1.participants[0].therapistId).toBe(therapistAId);
    expect(appt1.participants[0].requestedTherapist?.id).toBe(therapistAId);

    const g2 = await makeReservation();
    const res2 = await asUser(adminId, () =>
      bookAppointment({
        propertyId, treatmentId: namedTreatment.id, appointmentDate: dayStr(day(21)), startTime: "09:00",
        participants: [{ reservationId: g2.reservationId, therapistId: therapistAId }],
      })
    );
    expect(res2.status).toBe(400);
    const body2 = await res2.json();
    expect(body2.error).toMatch(/not available/i);
  });

  it("remembers a guest's explicitly-requested therapist and surfaces it as preferred next time — but not from a gender-only or plain auto-assigned visit", async () => {
    const prefTreatment = await prisma.spaTreatment.create({
      data: {
        propertyId, categoryId, name: `Pref-${uniq()}`, defaultDurationMinutes: 60, cleanupBufferMinutes: 0,
        chargeCodeId, rates: { create: [{ price: 65, effectiveFrom: new Date(2020, 0, 1) }] },
      },
    });
    await prisma.spaTherapistTreatment.createMany({
      data: [
        { therapistId: therapistAId, treatmentId: prefTreatment.id, qualified: true },
        { therapistId: therapistBId, treatmentId: prefTreatment.id, qualified: true },
      ],
    });
    await prisma.spaTreatmentRoom.createMany({
      data: [{ treatmentId: prefTreatment.id, roomId }, { treatmentId: prefTreatment.id, roomId: coupleRoomId }],
    });

    const guest = await makeReservation();
    const reservation = await prisma.reservation.findUniqueOrThrow({ where: { id: guest.reservationId } });
    const profileId = reservation.primaryGuestId;

    const before = await asUser(adminId, () =>
      therapistsForTreatmentRoute.GET(
        new Request(`http://localhost/api/spa/treatments/${prefTreatment.id}/therapists?propertyId=${propertyId}&profileId=${profileId}`),
        { params: Promise.resolve({ id: prefTreatment.id }) }
      )
    );
    const beforeList: { id: string; isPreferredForGuest: boolean }[] = await before.json();
    expect(beforeList.every((t) => !t.isPreferredForGuest)).toBe(true);

    const bookRes = await asUser(adminId, () =>
      bookAppointment({
        propertyId, treatmentId: prefTreatment.id, appointmentDate: dayStr(day(22)), startTime: "09:00",
        participants: [{ reservationId: guest.reservationId, therapistId: therapistAId }],
      })
    );
    expect(bookRes.status).toBe(201);

    const pref = await prisma.spaGuestTherapistPreference.findUnique({
      where: { profileId_propertyId: { profileId, propertyId } },
    });
    expect(pref?.therapistId).toBe(therapistAId);

    const after = await asUser(adminId, () =>
      therapistsForTreatmentRoute.GET(
        new Request(`http://localhost/api/spa/treatments/${prefTreatment.id}/therapists?propertyId=${propertyId}&profileId=${profileId}`),
        { params: Promise.resolve({ id: prefTreatment.id }) }
      )
    );
    const afterList: { id: string; isPreferredForGuest: boolean }[] = await after.json();
    expect(afterList.find((t) => t.id === therapistAId)?.isPreferredForGuest).toBe(true);

    // A second, different guest booking the same treatment with only a gender ask
    // (no specific name) must NOT get a remembered preference written.
    const genderOnlyGuest = await makeReservation();
    const genderOnlyReservation = await prisma.reservation.findUniqueOrThrow({ where: { id: genderOnlyGuest.reservationId } });
    await asUser(adminId, () =>
      bookAppointment({
        propertyId, treatmentId: prefTreatment.id, appointmentDate: dayStr(day(23)), startTime: "09:00",
        participants: [{ reservationId: genderOnlyGuest.reservationId }],
      })
    );
    const noPref = await prisma.spaGuestTherapistPreference.findUnique({
      where: { profileId_propertyId: { profileId: genderOnlyReservation.primaryGuestId, propertyId } },
    });
    expect(noPref).toBeNull();
  });

  it("GET .../availability with from/to reflects per-participant requirements, not just 'is anyone free'", async () => {
    const rangeTreatment = await prisma.spaTreatment.create({
      data: {
        propertyId, categoryId, name: `Range-${uniq()}`, defaultDurationMinutes: 60, cleanupBufferMinutes: 0,
        chargeCodeId, rates: { create: [{ price: 55, effectiveFrom: new Date(2020, 0, 1) }] },
      },
    });
    const weekdayOnly = await prisma.spaTherapist.create({ data: { propertyId, displayName: `Weekday-${uniq()}` } });
    await prisma.spaTherapistTreatment.create({ data: { therapistId: weekdayOnly.id, treatmentId: rangeTreatment.id, qualified: true } });
    await prisma.spaTreatmentRoom.create({ data: { treatmentId: rangeTreatment.id, roomId } });
    await prisma.spaTherapistSchedule.createMany({
      data: [1, 2, 3, 4, 5].map((dow) => ({
        therapistId: weekdayOnly.id, dayOfWeek: dow, startTime: "08:00", endTime: "20:00", effectiveFrom: new Date(2020, 0, 1),
      })),
    });

    const from = dayStr(day(0));
    const to = dayStr(day(13));
    const requirements = encodeURIComponent(JSON.stringify([{ requestedTherapistId: weekdayOnly.id }]));
    const res = await asUser(adminId, () =>
      availabilityRoute.GET(
        new Request(
          `http://localhost/api/spa/appointments/availability?propertyId=${propertyId}&treatmentId=${rangeTreatment.id}&partySize=1&from=${from}&to=${to}&requirements=${requirements}`
        )
      )
    );
    expect(res.status).toBe(200);
    const body: { days: { date: string; available: boolean }[] } = await res.json();
    expect(body.days.length).toBeGreaterThan(7);
    for (const d of body.days) {
      const dow = new Date(`${d.date}T00:00:00Z`).getUTCDay();
      expect(d.available).toBe(dow >= 1 && dow <= 5);
    }
  });

  it("GET /api/pos/search surfaces a reservation's accompanying guests, not just the primary", async () => {
    const primaryLastName = `Primary-${uniq()}`;
    const guest = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "Search", lastName: primaryLastName } });
    const companion = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "Companion", lastName: `Comp-${uniq()}` } });
    const reservation = await prisma.reservation.create({
      data: {
        propertyId, primaryGuestId: guest.upid, confirmationNo: `SPA-SEARCH-${uniq()}`,
        checkInDate: day(-1), checkOutDate: day(10), status: "IN_HOUSE",
        folios: { create: [{ propertyId, folioNumber: 1 }] },
        accompanyingGuests: { create: [{ profileId: companion.upid }] },
      },
    });

    const res = await asUser(adminId, () =>
      posSearchRoute.GET(new Request(`http://localhost/api/pos/search?propertyId=${propertyId}&query=${encodeURIComponent(primaryLastName)}`))
    );
    expect(res.status).toBe(200);
    const results: { reservationId: string; profileId: string; accompanyingGuests: { upid: string; guestName: string }[] }[] = await res.json();
    const match = results.find((r) => r.reservationId === reservation.id);
    expect(match).toBeTruthy();
    expect(match!.profileId).toBe(guest.upid);
    expect(match!.accompanyingGuests).toEqual([{ upid: companion.upid, guestName: `Companion ${companion.lastName}` }]);
  });
});
