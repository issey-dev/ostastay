import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import bcrypt from "bcryptjs";

// Phase 0 of BOOKING_API_ADDONS_PLAN.md — the foundations the public Excursion/Spa
// Booking API stands on, all of which also change what the desk gets:
//  - database-level booking locks (the last seat / therapist can't be sold twice, even
//    across app replicas),
//  - voiding a charge voids the tax/service lines it generated,
//  - the Spa lifecycle: check-in, start, complete (incl. AT_COMPLETION posting), cancel
//    with cutoff + late fee, no-show with grace + fee,
//  - the per-enterprise "Online Bookings" system actor,
//  - the Booking API rate limiter.

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
const cancelRoute = await import("@/app/api/spa/appointments/[id]/cancel/route");
const noShowRoute = await import("@/app/api/spa/appointments/[id]/no-show/route");
const checkInRoute = await import("@/app/api/spa/appointments/[id]/check-in/route");
const startRoute = await import("@/app/api/spa/appointments/[id]/start/route");
const completeRoute = await import("@/app/api/spa/appointments/[id]/complete/route");
const voidRoute = await import("@/app/api/folios/[id]/line-items/[itemId]/void/route");
const usersRoute = await import("@/app/api/settings/users/route");
const websitePropertiesRoute = await import("@/app/api/website/v1/properties/route");
const { createExcursionBooking } = await import("@/lib/excursion-booking");
const { ensureSystemUser, systemActorContext } = await import("@/lib/system-actor");
const { BookingError } = await import("@/lib/booking-error");
const { postCharge, chargeCodeInclude } = await import("@/lib/posting/post-charge");
const { computeSpaPolicyFee } = await import("@/lib/spa-lifecycle");
const { consumeRateLimit, RATE_LIMITS, _resetWebsiteRateLimiter } = await import("@/lib/website-api/rate-limit");
const { customChargeCode } = await import("../helpers/charge-codes");

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
const day = (offsetDays: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays));
};
const dayStr = (d: Date) => d.toISOString().slice(0, 10);
const post = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe("Booking API foundations (Phase 0)", () => {
  let enterpriseId: string;
  let propertyId: string;
  let adminId: string;
  let frontDeskId: string;
  let chargeCodeId: string;
  let treatmentId: string;
  let excursionTypeId: string;

  const makeReservation = async () => {
    const guest = await prisma.profile.create({
      data: { enterpriseId, profileType: "GUEST", firstName: "Found", lastName: `Guest-${uniq()}` },
    });
    const reservation = await prisma.reservation.create({
      data: {
        propertyId, primaryGuestId: guest.upid, confirmationNo: `FND-${uniq()}`,
        checkInDate: day(-2), checkOutDate: day(30), status: "IN_HOUSE",
        folios: { create: [{ propertyId, folioNumber: 1 }] },
      },
      include: { folios: true },
    });
    return { reservationId: reservation.id, folioId: reservation.folios[0].id };
  };

  const openWalkIn = (name = "Walk In") =>
    prisma.folio.create({ data: { propertyId, folioNumber: 1, walkInGuestName: name, walkInGuestContact: "+000" } });

  const bookSpa = async (reservationId: string, date = day(3), startTime = "10:00") => {
    const res = await asUser(adminId, () =>
      appointmentsRoute.POST(
        post("http://localhost/api/spa/appointments", {
          propertyId, treatmentId, appointmentDate: dayStr(date), startTime, participants: [{ reservationId }],
        })
      )
    );
    expect(res.status).toBe(201);
    return res.json();
  };

  const setSpaSettings = (data: Record<string, unknown>) =>
    prisma.spaSettings.upsert({ where: { propertyId }, update: data, create: { propertyId, ...data } });

  const liveLines = (folioId: string) => prisma.folioLineItem.findMany({ where: { folioId, isVoid: false } });

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
        enterpriseId: osta.id, email: `fnd-osta-${uniq()}@test.local`, passwordHash,
        firstName: "Osta", lastName: "Admin", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
      },
    });

    const enterprise = await prisma.enterprise.create({ data: { name: "Foundations", slug: `test-fnd-${uniq()}`, type: "STANDARD" } });
    enterpriseId = enterprise.id;
    const property = await prisma.property.create({
      data: {
        enterpriseId, name: "Foundations Resort", code: `FND-${uniq()}`, legalName: "Foundations LLC",
        defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyId = property.id;

    for (const addon of ["SPA", "EXCURSIONS"]) {
      await asUser(ostaAdmin.id, () =>
        enterpriseAddonsRoute.PATCH(
          new Request("http://localhost/api/licenses/enterprise-addons", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enterpriseId, module: addon, enabled: true }),
          })
        )
      );
    }

    // A charge code that GENERATES a 10% service line, so every void below also proves
    // the generated line is reversed with its parent.
    const generator = await customChargeCode(enterpriseId, { code: "FNDSPA", description: "Foundations Spa" });
    const generated = await customChargeCode(enterpriseId, { code: "FNDSVC", description: "Foundations Service" });
    await prisma.chargeCodeGenerate.create({
      data: { enterpriseId, generatorCodeId: generator.id, generatedCodeId: generated.id, method: "PERCENT", value: 10 },
    });
    chargeCodeId = generator.id;

    const spaOutlet = await prisma.outlet.create({ data: { propertyId, name: "Fnd Spa", code: "FNSP", outletType: "SPA" } });
    const excOutlet = await prisma.outlet.create({ data: { propertyId, name: "Fnd Tours", code: "FNEX", outletType: "EXCURSION" } });
    await prisma.enterpriseSettings.upsert({
      where: { enterpriseId },
      update: { spaOutletId: spaOutlet.id, excursionOutletId: excOutlet.id },
      create: {
        enterpriseId, resConfirmPrefix: "", resConfirmLength: 6, tgstEnabled: false, serviceChargeEnabled: false,
        greenTaxEnabled: false, spaOutletId: spaOutlet.id, excursionOutletId: excOutlet.id,
      },
    });

    adminId = (
      await prisma.user.create({
        data: {
          enterpriseId, email: `fnd-admin-${uniq()}@test.local`, passwordHash, firstName: "Admin", lastName: "Fnd",
          roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
        },
      })
    ).id;
    // Front Desk: SPA update (cancel before cutoff) but not SPA delete (no override).
    frontDeskId = (
      await prisma.user.create({
        data: {
          enterpriseId, email: `fnd-desk-${uniq()}@test.local`, passwordHash, firstName: "Desk", lastName: "Fnd",
          roles: { create: { roleId: roleIds["Front Desk"] } }, scope: "ENTERPRISE",
        },
      })
    ).id;

    const category = await prisma.spaTreatmentCategory.create({ data: { propertyId, name: "Massage" } });
    treatmentId = (
      await prisma.spaTreatment.create({
        data: {
          propertyId, categoryId: category.id, name: "Deep Tissue", defaultDurationMinutes: 60, cleanupBufferMinutes: 0,
          chargeCodeId, rates: { create: [{ price: 80, effectiveFrom: new Date(2020, 0, 1) }] },
        },
      })
    ).id;
    // Plenty of therapists and rooms: these tests are about lifecycle, not contention.
    for (let i = 0; i < 6; i++) {
      const t = await prisma.spaTherapist.create({ data: { propertyId, displayName: `T${i}` } });
      await prisma.spaTherapistTreatment.create({ data: { therapistId: t.id, treatmentId, qualified: true } });
      await prisma.spaTherapistSchedule.createMany({
        data: Array.from({ length: 7 }, (_, dow) => ({
          therapistId: t.id, dayOfWeek: dow, startTime: "06:00", endTime: "22:00", effectiveFrom: new Date(2020, 0, 1),
        })),
      });
      await prisma.spaRoom.create({ data: { propertyId, name: `Room ${i}`, capacity: 1 } });
    }

    excursionTypeId = (
      await prisma.excursionType.create({
        data: {
          propertyId, code: "FNDSNK", name: "Snorkel", chargeCodeId,
          rates: { create: [{ adultPrice: 50, childPrice: 25, infantPrice: 0, effectiveFrom: new Date(2020, 0, 1) }] },
        },
      })
    ).id;
  });

  // ---------------------------------------------------------------------------------
  describe("booking locks", () => {
    it("two simultaneous bookings for the last excursion seat — exactly one wins, the other is SOLD_OUT", async () => {
      const departure = await prisma.excursionDeparture.create({
        data: { excursionTypeId, departureDate: day(5), departureTime: "09:00", capacity: 1 },
      });
      const ctx = await systemActorContext(enterpriseId);
      const [a, b] = await Promise.all([openWalkIn("Racer A"), openWalkIn("Racer B")]);
      const results = await Promise.allSettled(
        [a, b].map((folio) =>
          createExcursionBooking(ctx, {
            departureId: departure.id,
            guest: { kind: "WALK_IN_FOLIO", folioId: folio.id },
            adultCount: 1, childCount: 0, infantCount: 0,
          })
        )
      );
      const won = results.filter((r) => r.status === "fulfilled");
      const lost = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(lost[0].reason).toBeInstanceOf(BookingError);
      expect(lost[0].reason.code).toBe("SOLD_OUT");
      expect(await prisma.excursionBooking.count({ where: { departureId: departure.id, status: "CONFIRMED" } })).toBe(1);
    });

    it("a booking made as the system actor is attributed to the Online Bookings user and its own drawer", async () => {
      const departure = await prisma.excursionDeparture.create({
        data: { excursionTypeId, departureDate: day(6), departureTime: "09:00", capacity: 10 },
      });
      const folio = await openWalkIn("Online Guest");
      const booking = await createExcursionBooking(await systemActorContext(enterpriseId), {
        departureId: departure.id, guest: { kind: "WALK_IN_FOLIO", folioId: folio.id }, adultCount: 2, childCount: 0, infantCount: 0,
      });
      const systemUser = await ensureSystemUser(enterpriseId);
      expect(booking.bookedByUserId).toBe(systemUser.id);
      const line = await prisma.folioLineItem.findUniqueOrThrow({ where: { id: booking.folioLineItemId! }, include: { shift: true } });
      expect(line.shift?.userId).toBe(systemUser.id);
      expect(line.shift?.propertyId).toBe(propertyId);
    });
  });

  // ---------------------------------------------------------------------------------
  describe("voiding a charge", () => {
    it("voids the lines the charge generated along with it", async () => {
      const { folioId } = await makeReservation();
      const code = await prisma.chargeCode.findUniqueOrThrow({ where: { id: chargeCodeId }, include: chargeCodeInclude() });
      const posted = await postCharge(prisma, {
        folioId, chargeCode: code, inputAmount: 100, settings: null, pricesIncludeTaxes: false, date: day(0),
      });
      const generated = await prisma.folioLineItem.findMany({ where: { generatedFromLineItemId: posted.parent.id } });
      expect(generated.length).toBeGreaterThan(0);

      const res = await asUser(adminId, () =>
        voidRoute.POST(post(`http://localhost/api/folios/${folioId}/line-items/${posted.parent.id}/void`, { reason: "Posted in error" }), {
          params: Promise.resolve({ id: folioId, itemId: posted.parent.id }),
        })
      );
      expect(res.status).toBe(200);
      expect(await liveLines(folioId)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------------
  describe("spa lifecycle", () => {
    beforeEach(async () => {
      await setSpaSettings({
        chargeTiming: "AT_BOOKING", cancellationCutoffHours: 4,
        lateCancellationChargeType: "NONE", lateCancellationChargeValue: null,
        noShowChargeType: "NONE", noShowChargeValue: null, noShowGraceMinutes: 15,
      });
    });

    it("policy fees: FULL, PERCENTAGE and FIXED are capped at the price; NONE charges nothing", () => {
      expect(computeSpaPolicyFee("NONE", null, 80)).toBe(0);
      expect(computeSpaPolicyFee("FULL", null, 80)).toBe(80);
      expect(computeSpaPolicyFee("PERCENTAGE", 25, 80)).toBe(20);
      expect(computeSpaPolicyFee("PERCENTAGE", 150, 80)).toBe(80);
      expect(computeSpaPolicyFee("FIXED", 30, 80)).toBe(30);
      expect(computeSpaPolicyFee("FIXED", 500, 80)).toBe(80);
    });

    it("cancel before the cutoff: the desk may do it, and the whole posting is voided", async () => {
      const { reservationId, folioId } = await makeReservation();
      const appt = await bookSpa(reservationId);
      expect((await liveLines(folioId)).length).toBeGreaterThan(1); // charge + generated service line

      const res = await asUser(frontDeskId, () =>
        cancelRoute.POST(post("http://localhost/x", { reasonCode: "GUEST_REQUEST" }), idParams(appt.id))
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.chargeVoided).toBe(true);
      expect(body.lateCancellation).toBe(false);
      expect(body.appointment.appointmentStatus).toBe("CANCELLED");
      expect(body.appointment.paymentStatus).toBe("VOIDED");
      expect(await liveLines(folioId)).toHaveLength(0);
      const stored = await prisma.spaAppointment.findUniqueOrThrow({ where: { id: appt.id } });
      expect(stored.cancellationReasonCode).toBe("GUEST_REQUEST");
      expect(stored.cancelledByUserId).toBe(frontDeskId);
    });

    it("cancel requires a known reason, and notes when the reason is OTHER", async () => {
      const { reservationId } = await makeReservation();
      const appt = await bookSpa(reservationId);
      const noReason = await asUser(adminId, () => cancelRoute.POST(post("http://localhost/x", {}), idParams(appt.id)));
      expect(noReason.status).toBe(400);
      const otherNoNotes = await asUser(adminId, () =>
        cancelRoute.POST(post("http://localhost/x", { reasonCode: "OTHER" }), idParams(appt.id))
      );
      expect(otherNoNotes.status).toBe(400);
    });

    it("cancel past the cutoff needs the override, and applies the late-cancellation fee", async () => {
      await setSpaSettings({ lateCancellationChargeType: "PERCENTAGE", lateCancellationChargeValue: 50 });
      const { reservationId, folioId } = await makeReservation();
      const appt = await bookSpa(reservationId);
      // Move it into the past: now well inside the cutoff window.
      await prisma.spaAppointment.update({ where: { id: appt.id }, data: { appointmentDate: day(-1) } });

      const desk = await asUser(frontDeskId, () =>
        cancelRoute.POST(post("http://localhost/x", { reasonCode: "GUEST_REQUEST" }), idParams(appt.id))
      );
      expect(desk.status).toBe(403);
      expect((await desk.json()).code).toBe("CANCEL_CUTOFF_PASSED");

      const manager = await asUser(adminId, () =>
        cancelRoute.POST(post("http://localhost/x", { reasonCode: "GUEST_REQUEST" }), idParams(appt.id))
      );
      expect(manager.status).toBe(200);
      const body = await manager.json();
      expect(body.lateCancellation).toBe(true);
      expect(body.feeCharged).toBe(40);
      expect(body.appointment.paymentStatus).toBe("POSTED_TO_FOLIO");
      const parents = (await liveLines(folioId)).filter((l) => !l.generatedFromLineItemId);
      expect(parents).toHaveLength(1);
      expect(parents[0].amount).toBeCloseTo(40, 2);
      expect(parents[0].id).toBe(body.appointment.folioLineItemId);
    });

    it("a manager can waive the late fee", async () => {
      await setSpaSettings({ lateCancellationChargeType: "FULL" });
      const { reservationId, folioId } = await makeReservation();
      const appt = await bookSpa(reservationId);
      await prisma.spaAppointment.update({ where: { id: appt.id }, data: { appointmentDate: day(-1) } });
      const res = await asUser(adminId, () =>
        cancelRoute.POST(post("http://localhost/x", { reasonCode: "ILLNESS", waiveFee: true }), idParams(appt.id))
      );
      expect(res.status).toBe(200);
      expect((await res.json()).feeCharged).toBe(0);
      expect(await liveLines(folioId)).toHaveLength(0);
    });

    it("no-show: refused before start + grace; afterwards FULL keeps the charge and NONE voids it", async () => {
      const early = await makeReservation();
      const future = await bookSpa(early.reservationId);
      const tooEarly = await asUser(adminId, () => noShowRoute.POST(post("http://localhost/x", {}), idParams(future.id)));
      expect(tooEarly.status).toBe(400);
      expect((await tooEarly.json()).code).toBe("TOO_EARLY");

      await setSpaSettings({ noShowChargeType: "FULL" });
      const full = await makeReservation();
      const kept = await bookSpa(full.reservationId);
      await prisma.spaAppointment.update({ where: { id: kept.id }, data: { appointmentDate: day(-1) } });
      const keptRes = await asUser(frontDeskId, () => noShowRoute.POST(post("http://localhost/x", {}), idParams(kept.id)));
      expect(keptRes.status).toBe(200);
      expect((await keptRes.json()).appointment.appointmentStatus).toBe("NO_SHOW");
      expect((await liveLines(full.folioId)).length).toBeGreaterThan(0);

      await setSpaSettings({ noShowChargeType: "NONE" });
      const none = await makeReservation();
      const voided = await bookSpa(none.reservationId);
      await prisma.spaAppointment.update({ where: { id: voided.id }, data: { appointmentDate: day(-1) } });
      const voidedRes = await asUser(frontDeskId, () => noShowRoute.POST(post("http://localhost/x", {}), idParams(voided.id)));
      expect(voidedRes.status).toBe(200);
      expect(await liveLines(none.folioId)).toHaveLength(0);
    });

    it("check-in → start → complete; check-in is refused on a later day and steps can't be skipped", async () => {
      const { reservationId } = await makeReservation();
      const appt = await bookSpa(reservationId);

      const future = await asUser(frontDeskId, () => checkInRoute.POST(post("http://localhost/x", {}), idParams(appt.id)));
      expect(future.status).toBe(400);

      await prisma.spaAppointment.update({ where: { id: appt.id }, data: { appointmentDate: day(0) } });
      const skip = await asUser(frontDeskId, () => startRoute.POST(post("http://localhost/x", {}), idParams(appt.id)));
      expect(skip.status).toBe(400);

      for (const route of [checkInRoute, startRoute]) {
        const r = await asUser(frontDeskId, () => route.POST(post("http://localhost/x", {}), idParams(appt.id)));
        expect(r.status).toBe(200);
      }
      const done = await asUser(frontDeskId, () => completeRoute.POST(post("http://localhost/x", {}), idParams(appt.id)));
      expect(done.status).toBe(200);
      const body = await done.json();
      expect(body.chargePosted).toBe(false); // AT_BOOKING already posted
      expect(body.appointment.appointmentStatus).toBe("COMPLETED");
    });

    it("AT_COMPLETION: nothing posts at booking; completion posts the price fixed at booking to the booked folio", async () => {
      await setSpaSettings({ chargeTiming: "AT_COMPLETION" });
      const { reservationId, folioId } = await makeReservation();
      const appt = await bookSpa(reservationId);
      expect(appt.paymentStatus).toBe("NOT_POSTED");
      expect(appt.folioId).toBe(folioId);
      expect(await liveLines(folioId)).toHaveLength(0);

      // A rate change after booking must not change what the guest pays.
      await prisma.spaTreatmentRate.updateMany({ where: { treatmentId }, data: { price: 999 } });
      try {
        await prisma.spaAppointment.update({ where: { id: appt.id }, data: { appointmentDate: day(0) } });
        for (const route of [checkInRoute, startRoute, completeRoute]) {
          const r = await asUser(frontDeskId, () => route.POST(post("http://localhost/x", {}), idParams(appt.id)));
          expect(r.status).toBe(200);
        }
      } finally {
        await prisma.spaTreatmentRate.updateMany({ where: { treatmentId }, data: { price: 80 } });
      }
      const stored = await prisma.spaAppointment.findUniqueOrThrow({ where: { id: appt.id }, include: { folioLineItem: true } });
      expect(stored.paymentStatus).toBe("POSTED_TO_FOLIO");
      expect(stored.folioLineItem?.folioId).toBe(folioId);
      expect(stored.folioLineItem?.amount).toBeCloseTo(80, 2);
    });
  });

  // ---------------------------------------------------------------------------------
  describe("system actor", () => {
    it("is created once, can't sign in, and never appears in or is editable from user management", async () => {
      const [a, b] = await Promise.all([ensureSystemUser(enterpriseId), ensureSystemUser(enterpriseId)]);
      expect(a.id).toBe(b.id);
      expect(a.isActive).toBe(false);
      expect(a.isSystem).toBe(true);

      const list = await asUser(adminId, () => usersRoute.GET());
      const users: Array<{ id: string }> = await list.json();
      expect(users.some((u) => u.id === a.id)).toBe(false);

      const patch = await asUser(adminId, () =>
        usersRoute.PATCH(
          new Request("http://localhost/api/settings/users", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: a.id, isActive: true }),
          })
        )
      );
      expect(patch.status).toBe(404);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).isActive).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------
  describe("Booking API rate limits", () => {
    beforeEach(() => _resetWebsiteRateLimiter());

    it("counts per bucket and subject, refusing past the limit with a reset time", async () => {
      const subject = `key-${uniq()}`;
      for (let i = 0; i < RATE_LIMITS.write; i++) {
        expect((await consumeRateLimit("write", subject)).allowed).toBe(true);
      }
      const refused = await consumeRateLimit("write", subject);
      expect(refused.allowed).toBe(false);
      expect(refused.remaining).toBe(0);
      expect(refused.resetSeconds).toBeGreaterThan(0);
      // Other buckets and other subjects are unaffected.
      expect((await consumeRateLimit("read", subject)).allowed).toBe(true);
      expect((await consumeRateLimit("write", `other-${uniq()}`)).allowed).toBe(true);
    });

    it("an IP spraying bad keys gets 429 with Retry-After instead of more 401s", async () => {
      const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
      const call = () =>
        websitePropertiesRoute.GET(
          new Request("http://localhost/api/website/v1/properties", {
            headers: { authorization: `Bearer wsk_${"0".repeat(64)}`, "x-forwarded-for": ip },
          }),
          { params: Promise.resolve({}) }
        );
      for (let i = 0; i < RATE_LIMITS.authFailure; i++) {
        expect((await call()).status).toBe(401);
      }
      const limited = await call();
      expect(limited.status).toBe(429);
      expect((await limited.json()).code).toBe("RATE_LIMITED");
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    });
  });
});
