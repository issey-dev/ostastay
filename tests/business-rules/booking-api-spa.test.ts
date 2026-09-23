import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import bcrypt from "bcryptjs";

// Phase 3 of BOOKING_API_ADDONS_PLAN.md — the public Spa endpoints through the real
// routes: treatments, free times, quote == what is posted, hold (a real TENTATIVE
// appointment) → book, gender preference, couples, expiry, lookup and self-cancel.

const { prisma } = await import("@/lib/db");
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");
const { customChargeCode } = await import("../helpers/charge-codes");
const { createWebsiteApiKey } = await import("@/lib/website-api/keys");
const { _resetWebsiteRateLimiter } = await import("@/lib/website-api/rate-limit");
const { expireStaleSpaHolds } = await import("@/lib/spa-booking");
const treatmentsRoute = await import("@/app/api/website/v1/properties/[propertyId]/spa/treatments/route");
const availabilityRoute = await import("@/app/api/website/v1/properties/[propertyId]/spa/availability/route");
const quoteRoute = await import("@/app/api/website/v1/properties/[propertyId]/spa/quote/route");
const holdsRoute = await import("@/app/api/website/v1/properties/[propertyId]/spa/holds/route");
const bookingsRoute = await import("@/app/api/website/v1/properties/[propertyId]/spa/bookings/route");
const lookupRoute = await import("@/app/api/website/v1/activity-bookings/[reference]/route");
const cancelRoute = await import("@/app/api/website/v1/activity-bookings/[reference]/cancel/route");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const day = (offset: number) => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offset));
};
const dayStr = (d: Date) => d.toISOString().slice(0, 10);
const BASE = "http://localhost/api/website/v1";
function req(path: string, key: string, opts: { body?: unknown; idem?: string } = {}) {
  const headers: Record<string, string> = { authorization: `Bearer ${key}` };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.idem) headers["idempotency-key"] = opts.idem;
  return new Request(`${BASE}${path}`, {
    method: opts.body !== undefined ? "POST" : "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}
const p = <P,>(x: P) => ({ params: Promise.resolve(x) });
const idem = () => `idem-${uniq()}`;
const guest = (email = `spa-${uniq()}@example.com`) => ({ firstName: "Grace", lastName: "Hopper", email });
const unpaid = { status: "UNPAID" };

describe("Booking API — Spa (Phase 3)", () => {
  let enterpriseId: string;
  let propertyId: string;
  let soloId: string; // 1 guest, 1 single room
  let coupleId: string; // 2 guests, flat price, couple room
  let hiddenId: string;
  let femaleId: string;
  let key = "";
  let paymentMethodId: string;
  // Each test books its own day so tests never contend with each other.
  let nextDay = 3;
  const freshDay = () => dayStr(day(nextDay++));

  const book = (body: Record<string, unknown>, idemKey = idem()) =>
    bookingsRoute.POST(req(`/properties/${propertyId}/spa/bookings`, key, { body, idem: idemKey }), p({ propertyId }));
  const hold = (body: Record<string, unknown>) =>
    holdsRoute.POST(req(`/properties/${propertyId}/spa/holds`, key, { body }), p({ propertyId }));
  const slotFree = async (date: string, startTime: string, treatmentId = soloId) => {
    const res = await availabilityRoute.GET(req(`/properties/${propertyId}/spa/availability?treatmentId=${treatmentId}&date=${date}`, key), p({ propertyId }));
    const body = await res.json();
    return body.slots.find((s: { startTime: string }) => s.startTime === startTime)?.available ?? false;
  };
  const setOnline = (data: Record<string, unknown>) =>
    prisma.activityOnlineSettings.update({ where: { propertyId_module: { propertyId, module: "SPA" } }, data });

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    enterpriseId = (await prisma.enterprise.create({ data: { name: "Spa API", slug: `test-spaapi-${uniq()}`, type: "STANDARD" } })).id;
    propertyId = (
      await prisma.property.create({
        data: {
          enterpriseId, name: "Coral Bay Spa", code: `CBS-${uniq()}`, legalName: "Coral Bay LLC",
          defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
        },
      })
    ).id;
    const admin = await prisma.user.create({
      data: {
        enterpriseId, email: `spaapi-${uniq()}@test.local`, passwordHash: await bcrypt.hash("x", 4), firstName: "A", lastName: "B",
        roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
      },
    });
    await prisma.enterpriseAddonAccess.create({ data: { enterpriseId, module: "SPA", enabled: true } });

    const code = await customChargeCode(enterpriseId, { code: "CBSPA", description: "Spa" });
    const svc = await customChargeCode(enterpriseId, { code: "CBSPASVC", description: "Spa service" });
    await prisma.chargeCodeGenerate.create({ data: { enterpriseId, generatorCodeId: code.id, generatedCodeId: svc.id, method: "PERCENT", value: 10 } });
    const outlet = await prisma.outlet.create({ data: { propertyId, name: "Spa", code: "CBSP", outletType: "SPA" } });
    await prisma.enterpriseSettings.create({
      data: { enterpriseId, tgstEnabled: false, serviceChargeEnabled: false, greenTaxEnabled: false, spaOutletId: outlet.id },
    });
    const payCode = await customChargeCode(enterpriseId, { code: "CBSPAPAY", description: "Online card", postingType: "PAYMENT" });
    paymentMethodId = (await prisma.paymentMethod.create({ data: { enterpriseId, name: "Online card", type: "CARD", chargeCodeId: payCode.id } })).id;
    await prisma.spaSettings.create({ data: { propertyId, defaultOpeningTime: "08:00", defaultClosingTime: "20:00", slotIntervalMinutes: 30, cancellationCutoffHours: 4 } });
    await prisma.activityOnlineSettings.create({
      data: { propertyId, module: "SPA", enabled: true, holdMinutes: 10, leadHours: 2, offerGenderPreference: true, onlinePaymentMethodId: paymentMethodId },
    });

    const cat = await prisma.spaTreatmentCategory.create({ data: { propertyId, name: "Massage" } });
    const mk = (data: Record<string, unknown>) =>
      prisma.spaTreatment.create({ data: { propertyId, categoryId: cat.id, chargeCodeId: code.id, defaultDurationMinutes: 60, cleanupBufferMinutes: 0, ...data } as never });
    soloId = (await mk({ name: "Island Massage", publishOnline: true, publicDescription: "Full body", rates: { create: [{ price: 100, effectiveFrom: new Date(2020, 0, 1) }] } })).id;
    coupleId = (await mk({ name: "Couples Ritual", publishOnline: true, maxParticipants: 2, pricingMode: "FLAT", rates: { create: [{ price: 300, effectiveFrom: new Date(2020, 0, 1) }] } })).id;
    hiddenId = (await mk({ name: "Staff only", publishOnline: false, rates: { create: [{ price: 10, effectiveFrom: new Date(2020, 0, 1) }] } })).id;

    const female = await prisma.spaTherapist.create({ data: { propertyId, displayName: "Aisha", gender: "FEMALE" } });
    const male = await prisma.spaTherapist.create({ data: { propertyId, displayName: "Ibrahim", gender: "MALE" } });
    femaleId = female.id;
    for (const t of [female, male]) {
      for (const tr of [soloId, coupleId]) await prisma.spaTherapistTreatment.create({ data: { therapistId: t.id, treatmentId: tr, qualified: true } });
      await prisma.spaTherapistSchedule.createMany({
        data: Array.from({ length: 7 }, (_, dow) => ({ therapistId: t.id, dayOfWeek: dow, startTime: "06:00", endTime: "22:00", effectiveFrom: new Date(2020, 0, 1) })),
      });
    }
    const single = await prisma.spaRoom.create({ data: { propertyId, name: "Single", capacity: 1 } });
    const double = await prisma.spaRoom.create({ data: { propertyId, name: "Double", capacity: 2 } });
    await prisma.spaTreatmentRoom.createMany({ data: [{ treatmentId: soloId, roomId: single.id }, { treatmentId: coupleId, roomId: double.id }] });

    key = (await createWebsiteApiKey({ enterpriseId, userId: admin.id, name: "spa-site", propertyIds: [propertyId], allowedOrigins: [], scopes: ["SPA"], expiresAt: null })).key;
  });

  beforeEach(() => _resetWebsiteRateLimiter());

  it("treatments: only published walk-in treatments, grouped, with the online rules", async () => {
    const res = await treatmentsRoute.GET(req(`/properties/${propertyId}/spa/treatments`, key), p({ propertyId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.categories.flatMap((c: { treatments: { id: string }[] }) => c.treatments.map((t) => t.id));
    expect(ids).toEqual(expect.arrayContaining([soloId, coupleId]));
    expect(ids).not.toContain(hiddenId);
    expect(body.booking).toMatchObject({ enabled: true, genderPreferenceOffered: true, freeCancellationHours: 4, paidOnlineAccepted: true });
    // Therapists and rooms are never exposed.
    expect(JSON.stringify(body)).not.toContain("Aisha");
  });

  it("quote equals what is posted; a PAID booking is CONFIRMED, settled, and named", async () => {
    const date = freshDay();
    const { quote } = await (await quoteRoute.POST(req(`/properties/${propertyId}/spa/quote`, key, { body: { treatmentId: soloId, date } }), p({ propertyId }))).json();
    expect(quote.totals.base).toBeCloseTo(100, 2);
    expect(quote.totals.grandTotal).toBeGreaterThan(100);

    const res = await book({
      treatmentId: soloId, date, startTime: "10:00", guest: guest(), expectedTotal: quote.totals.grandTotal,
      payment: { status: "PAID", provider: "Stripe", reference: "pi_spa", amount: quote.totals.grandTotal },
    });
    expect(res.status).toBe(201);
    const { booking } = await res.json();
    expect(booking.reference).toMatch(/^SPA-/);
    expect(booking).toMatchObject({ status: "CONFIRMED", startTime: "10:00", guests: ["Grace Hopper"] });

    const record = await prisma.apiActivityBooking.findUniqueOrThrow({ where: { publicRef: booking.reference }, include: { spaAppointment: true } });
    const appt = record.spaAppointment!;
    expect(appt.source).toBe("WEBSITE_API");
    expect(appt.paymentStatus).toBe("PAID");
    const lines = await prisma.folioLineItem.findMany({ where: { folioId: appt.folioId!, isVoid: false } });
    expect(lines.reduce((s, l) => s + l.amount + l.taxAmount + l.serviceChargeAmount, 0)).toBeCloseTo(quote.totals.grandTotal, 2);
    const pay = await prisma.payment.findMany({ where: { folioId: appt.folioId! } });
    expect(pay[0].amount).toBeCloseTo(quote.totals.grandTotal, 2);
    expect(await slotFree(date, "10:00")).toBe(false);
  });

  it("a hold is a real tentative appointment: it blocks the slot, then converts once", async () => {
    const date = freshDay();
    const h = await hold({ treatmentId: soloId, date, startTime: "11:00" });
    expect(h.status).toBe(201);
    const { hold: held } = await h.json();
    expect(await slotFree(date, "11:00")).toBe(false);

    const taken = await book({ treatmentId: soloId, date, startTime: "11:00", guest: guest(), payment: unpaid });
    expect(taken.status).toBe(409);
    expect((await taken.json()).code).toBe("SLOT_UNAVAILABLE");

    const ok = await book({ holdId: held.holdId, guest: guest(), payment: unpaid });
    expect(ok.status).toBe(201);
    const record = await prisma.apiActivityBooking.findUniqueOrThrow({ where: { id: held.holdId }, include: { spaAppointment: { include: { participants: true } } } });
    expect(record.status).toBe("CONFIRMED");
    expect(record.spaAppointment!.appointmentStatus).toBe("CONFIRMED");
    expect(record.spaAppointment!.holdExpiresAt).toBeNull();
    expect(record.spaAppointment!.participants[0].walkInGuestName).toBe("Grace Hopper");

    const again = await book({ holdId: held.holdId, guest: guest(), payment: unpaid });
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe("HOLD_USED");
  });

  it("an expired hold frees the slot, can't be booked, and is tidied away", async () => {
    const date = freshDay();
    const { hold: held } = await (await hold({ treatmentId: soloId, date, startTime: "12:00" })).json();
    const rec = await prisma.apiActivityBooking.findUniqueOrThrow({ where: { id: held.holdId } });
    await prisma.spaAppointment.update({ where: { id: rec.spaAppointmentId! }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    await prisma.apiActivityBooking.update({ where: { id: held.holdId }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });

    expect(await slotFree(date, "12:00")).toBe(true);
    const expired = await book({ holdId: held.holdId, guest: guest(), payment: unpaid });
    expect(expired.status).toBe(409);
    expect((await expired.json()).code).toBe("HOLD_EXPIRED");

    await expireStaleSpaHolds(propertyId);
    const appt = await prisma.spaAppointment.findUniqueOrThrow({ where: { id: rec.spaAppointmentId! } });
    expect(appt.appointmentStatus).toBe("CANCELLED");
    expect(appt.cancellationReasonCode).toBe("HOLD_EXPIRED");
    expect((await prisma.apiActivityBooking.findUniqueOrThrow({ where: { id: held.holdId } })).status).toBe("EXPIRED");
  });

  it("gender preference is honoured when offered and refused when not", async () => {
    const date = freshDay();
    const res = await book({ treatmentId: soloId, date, startTime: "13:00", gender: "FEMALE", guest: guest(), payment: unpaid });
    expect(res.status).toBe(201);
    const record = await prisma.apiActivityBooking.findUniqueOrThrow({
      where: { publicRef: (await res.json()).booking.reference },
      include: { spaAppointment: { include: { participants: true } } },
    });
    expect(record.spaAppointment!.participants[0].therapistId).toBe(femaleId);

    await setOnline({ offerGenderPreference: false });
    try {
      const refused = await book({ treatmentId: soloId, date, startTime: "15:00", gender: "MALE", guest: guest(), payment: unpaid });
      expect(refused.status).toBe(400);
    } finally {
      await setOnline({ offerGenderPreference: true });
    }
  });

  it("couples: one flat price, a therapist each, companions named; too many guests refused", async () => {
    const date = freshDay();
    const res = await book({ treatmentId: coupleId, date, startTime: "14:00", partySize: 2, companions: ["Alan Turing"], guest: guest(), payment: unpaid });
    expect(res.status).toBe(201);
    const { booking } = await res.json();
    expect(booking.guests).toEqual(["Grace Hopper", "Alan Turing"]);
    const record = await prisma.apiActivityBooking.findUniqueOrThrow({ where: { publicRef: booking.reference }, include: { spaAppointment: { include: { participants: true } } } });
    const therapists = record.spaAppointment!.participants.map((x) => x.therapistId);
    expect(new Set(therapists).size).toBe(2);
    expect(record.spaAppointment!.priceSnapshot).toBe(300);

    const three = await book({ treatmentId: coupleId, date, startTime: "16:00", partySize: 3, guest: guest(), payment: unpaid });
    expect(three.status).toBe(400);
    expect((await three.json()).code).toBe("PARTY_TOO_LARGE");
  });

  it("posts at booking even when the spa charges at completion", async () => {
    const date = freshDay();
    await prisma.spaSettings.update({ where: { propertyId }, data: { chargeTiming: "AT_COMPLETION" } });
    try {
      const res = await book({ treatmentId: soloId, date, startTime: "09:00", guest: guest(), payment: unpaid });
      expect(res.status).toBe(201);
      const record = await prisma.apiActivityBooking.findUniqueOrThrow({ where: { publicRef: (await res.json()).booking.reference }, include: { spaAppointment: true } });
      expect(record.spaAppointment!.paymentStatus).toBe("POSTED_TO_FOLIO");
      expect(record.spaAppointment!.folioLineItemId).toBeTruthy();
    } finally {
      await prisma.spaSettings.update({ where: { propertyId }, data: { chargeTiming: "AT_BOOKING" } });
    }
  });

  it("a changed price rolls the whole booking back; the same Idempotency-Key replays", async () => {
    const date = freshDay();
    const before = await prisma.spaAppointment.count({ where: { propertyId } });
    const wrong = await book({ treatmentId: soloId, date, startTime: "10:00", guest: guest(), payment: unpaid, expectedTotal: 1 });
    expect(wrong.status).toBe(409);
    expect((await wrong.json()).code).toBe("PRICE_CHANGED");
    expect(await prisma.spaAppointment.count({ where: { propertyId } })).toBe(before);

    const k = idem();
    const a = await book({ treatmentId: soloId, date, startTime: "10:00", guest: guest(), payment: unpaid }, k);
    const b = await book({ treatmentId: soloId, date, startTime: "10:00", guest: guest(), payment: unpaid }, k);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect((await b.json()).booking.reference).toBe((await a.json()).booking.reference);
  });

  it("lookup and self-cancel: voided, refund flagged when paid, refused past the cutoff", async () => {
    const date = freshDay();
    const email = `spa-cancel-${uniq()}@example.com`;
    const q = (await (await quoteRoute.POST(req(`/properties/${propertyId}/spa/quote`, key, { body: { treatmentId: soloId, date } }), p({ propertyId }))).json()).quote;
    const { booking } = await (await book({ treatmentId: soloId, date, startTime: "17:00", guest: guest(email), payment: { status: "PAID", amount: q.totals.grandTotal } })).json();

    const seen = await lookupRoute.GET(req(`/activity-bookings/${booking.reference}?email=${email}`, key), p({ reference: booking.reference }));
    expect((await seen.json()).booking).toMatchObject({ module: "SPA", status: "CONFIRMED", cancellation: { allowed: true } });

    const res = await cancelRoute.POST(req(`/activity-bookings/${booking.reference}/cancel`, key, { body: { email } }), p({ reference: booking.reference }));
    expect(res.status).toBe(200);
    const body = (await res.json()).booking;
    expect(body.status).toBe("CANCELLED");
    expect(body.cancellation.refundRequired).toBe(true);
    const record = await prisma.apiActivityBooking.findUniqueOrThrow({ where: { publicRef: booking.reference }, include: { spaAppointment: true } });
    expect(record.spaAppointment!.paymentStatus).toBe("REFUND_REQUIRED");
    expect(await prisma.folioLineItem.count({ where: { folioId: record.spaAppointment!.folioId!, isVoid: false } })).toBe(0);

    const lateEmail = `spa-late-${uniq()}@example.com`;
    const late = (await (await book({ treatmentId: soloId, date, startTime: "18:00", guest: guest(lateEmail), payment: unpaid })).json()).booking;
    await prisma.spaSettings.update({ where: { propertyId }, data: { cancellationCutoffHours: 1000 } });
    try {
      const refused = await cancelRoute.POST(req(`/activity-bookings/${late.reference}/cancel`, key, { body: { email: lateEmail } }), p({ reference: late.reference }));
      expect(refused.status).toBe(409);
      expect((await refused.json()).code).toBe("CANCEL_CUTOFF_PASSED");
    } finally {
      await prisma.spaSettings.update({ where: { propertyId }, data: { cancellationCutoffHours: 4 } });
    }
  });
});
