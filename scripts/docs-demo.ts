// npm run docs:demo — create the FICTIONAL enterprise the documentation screenshots are
// taken from (npm run docs:shots). Local development only; refuses to run in production.
//
// Published screenshots must never show a real customer, so the docs are shot against
// "Coral Bay Hotels" (enterprise code `coralbay`), the same example the Booking API pages
// use. It has two properties:
//   CBR  Coral Bay Resort  — set up end to end, as the Configuration guide describes
//   CBL  Coral Bay Lodge   — exactly as provisioning leaves a new property (the "before")
// Both are provisioned the way the Osta console does it (src/app/api/osta/properties/
// create/route.ts): Base Rate plan, system charge codes, inactive fee rules. The admin
// account has an unusable password — docs:shots signs in by minting a session directly.
//
// Idempotent: re-running only adds what is missing.
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";
import { goLiveDate } from "../src/lib/business-date";
import { chartModulesFor, ensureChargeTree, ensureFeeRules } from "../src/lib/posting/ensure-charge-tree";
import { expandScheduleDates } from "../src/lib/excursions";

if (process.env.NODE_ENV === "production") {
  console.error("docs:demo is for local development only.");
  process.exit(1);
}

export const DEMO = {
  slug: "coralbay",
  adminEmail: "admin@coralbay.example.com",
  resort: "CBR",
  lodge: "CBL",
};

const EFFECTIVE = new Date("2026-01-01");

async function findOrCreate<T>(find: () => Promise<T | null>, create: () => Promise<T>): Promise<T> {
  return (await find()) ?? (await create());
}

async function provisionProperty(enterpriseId: string, data: { code: string; name: string; legalName: string; address: string; phone: string; email: string }) {
  const existing = await prisma.property.findUnique({ where: { code: data.code } });
  if (existing) return existing;
  const property = await prisma.property.create({
    data: {
      enterpriseId,
      name: data.name,
      code: data.code,
      legalName: data.legalName,
      defaultCurrency: "USD",
      timeZone: "Indian/Maldives",
      checkInTime: "14:00",
      checkOutTime: "12:00",
      address: data.address,
      contactPhone: data.phone,
      contactEmail: data.email,
      status: "ACTIVE",
      businessDate: goLiveDate(undefined),
      reviewedAt: new Date(),
    },
  });
  await prisma.ratePlan.create({ data: { propertyId: property.id, code: "BASE", name: "Base Rate", priority: 999, isLocked: true } });
  return property;
}

async function main() {
  // ── Enterprise, licence, add-ons ──────────────────────────────────────────────────
  const enterprise = await prisma.enterprise.upsert({
    where: { slug: DEMO.slug },
    update: {},
    create: { name: "Coral Bay Hotels", slug: DEMO.slug, type: "STANDARD" },
  });
  await prisma.enterpriseLicense.upsert({
    where: { enterpriseId: enterprise.id },
    update: {},
    create: { enterpriseId: enterprise.id, maxProperties: 3 },
  });
  await prisma.enterpriseSettings.upsert({ where: { enterpriseId: enterprise.id }, update: {}, create: { enterpriseId: enterprise.id } });
  for (const module of ["SPA", "EXCURSIONS"]) {
    await prisma.enterpriseAddonAccess.upsert({
      where: { enterpriseId_module: { enterpriseId: enterprise.id, module } },
      update: { enabled: true },
      create: { enterpriseId: enterprise.id, module, enabled: true },
    });
  }

  // System roles are shared, owned by the internal enterprise.
  const systemRoles = await prisma.role.findMany({ where: { isSystem: true, enterprise: { type: "INTERNAL" } } });
  const roleId = (name: string) => {
    const r = systemRoles.find((x) => x.name === name);
    if (!r) throw new Error(`System role "${name}" not found — run npm run seed first.`);
    return r.id;
  };

  // Nobody signs in to the demo with a password.
  const unusable = await bcrypt.hash(randomBytes(24).toString("hex"), 10);
  const admin = await prisma.user.upsert({
    where: { email: DEMO.adminEmail },
    update: {},
    create: {
      enterpriseId: enterprise.id,
      email: DEMO.adminEmail,
      passwordHash: unusable,
      firstName: "Maya",
      lastName: "Hassan",
      jobFunction: "MANAGEMENT",
      scope: "ENTERPRISE",
      isProtected: true,
      roles: { create: { roleId: roleId("Admin") } },
    },
  });

  // ── Properties, provisioned as the Osta console does ─────────────────────────────
  const resort = await provisionProperty(enterprise.id, {
    code: DEMO.resort,
    name: "Coral Bay Resort",
    legalName: "Coral Bay Hospitality Pvt Ltd",
    address: "Coral Bay Island, North Atoll, Maldives",
    phone: "+960 300 0100",
    email: "reservations@coralbay.example.com",
  });
  const lodge = await provisionProperty(enterprise.id, {
    code: DEMO.lodge,
    name: "Coral Bay Lodge",
    legalName: "Coral Bay Hospitality Pvt Ltd",
    address: "Harbour Road, South Atoll, Maldives",
    phone: "+960 300 0200",
    email: "lodge@coralbay.example.com",
  });
  const modules = await chartModulesFor(prisma, enterprise.id);
  await ensureChargeTree(prisma, { propertyId: lodge.id }, modules);
  await ensureFeeRules(prisma, { propertyId: lodge.id });
  // The resort gets the fuller demo chart (the codes a property would create itself).
  await ensureChargeTree(prisma, { propertyId: resort.id }, modules, { demo: true });
  await ensureFeeRules(prisma, { propertyId: resort.id });
  const P = resort.id;
  // Step 1 (General) filled in, and meal plans drive the packages (step 6).
  await prisma.property.update({
    where: { id: P },
    data: { starRating: 4, taxId: "1000000GST001", allocationCalculationMode: "MEAL_PLAN" },
  });

  // ── People ──────────────────────────────────────────────────────────────────────
  const people: Array<{ email: string; first: string; last: string; role: string; job?: string; propertyId?: string }> = [
    { email: "frontoffice@coralbay.example.com", first: "Ahmed", last: "Rasheed", role: "Front Desk", job: "FRONT_OFFICE", propertyId: P },
    { email: "reservations@coralbay.example.com", first: "Sara", last: "Ibrahim", role: "Reservations", job: "RESERVATIONS" },
    { email: "cashier@coralbay.example.com", first: "Ali", last: "Mohamed", role: "Cashier", job: "CASHIER", propertyId: P },
    { email: "housekeeping@coralbay.example.com", first: "Aminath", last: "Shareef", role: "Housekeeping", job: "HOUSEKEEPING", propertyId: P },
  ];
  for (const p of people) {
    await prisma.user.upsert({
      where: { email: p.email },
      update: {},
      create: {
        enterpriseId: enterprise.id,
        email: p.email,
        passwordHash: unusable,
        firstName: p.first,
        lastName: p.last,
        jobFunction: p.job ?? null,
        scope: p.propertyId ? "PROPERTY" : "ENTERPRISE",
        propertyId: p.propertyId ?? null,
        roles: { create: { roleId: roleId(p.role) } },
      },
    });
  }
  await findOrCreate(
    () => prisma.role.findFirst({ where: { enterpriseId: enterprise.id, name: "Night Manager" } }),
    () =>
      prisma.role.create({
        data: {
          enterpriseId: enterprise.id,
          name: "Night Manager",
          permissions: {
            create: [
              { module: "FRONT_DESK", canView: true, canCreate: true, canUpdate: true },
              { module: "RESERVATIONS", canView: true, canCreate: true, canUpdate: true },
              { module: "CASHIERING", canView: true, canCreate: true, canUpdate: true },
              { module: "NIGHT_AUDIT", canView: true, canCreate: true, canUpdate: true },
              { module: "DAILY_REPORTS", canView: true },
              { module: "DASHBOARD", canView: true },
            ],
          },
        },
      })
  );

  // ── Guest lists (enterprise-wide) ─────────────────────────────────────────────────
  const guestLists = [
    ["GENDER", "M", "Male"], ["GENDER", "F", "Female"],
    ["TITLE", "MR", "Mr"], ["TITLE", "MRS", "Mrs"], ["TITLE", "MS", "Ms"], ["TITLE", "DR", "Dr"],
    ["ID_TYPE", "PASSPORT", "Passport"], ["ID_TYPE", "NID", "National ID card"],
    ["CLASSIFICATION", "REGULAR", "Regular"], ["CLASSIFICATION", "REPEAT", "Repeat guest"], ["CLASSIFICATION", "CORPORATE", "Corporate"],
    ["VIP_LEVEL", "SILVER", "Silver"], ["VIP_LEVEL", "GOLD", "Gold"], ["VIP_LEVEL", "PLATINUM", "Platinum"],
    ["DIETARY_REQ", "VEGETARIAN", "Vegetarian"], ["DIETARY_REQ", "VEGAN", "Vegan"], ["DIETARY_REQ", "GLUTEN_FREE", "Gluten-free"],
    ["PREFERENCE", "QUIET_ROOM", "Quiet room"], ["PREFERENCE", "EXTRA_PILLOWS", "Extra pillows"],
  ];
  const propertyLists = [
    ["BED_TYPE", "KING", "King bed"], ["BED_TYPE", "TWIN", "Twin beds"],
    ["ROOM_VIEW", "OCEAN", "Ocean view"], ["ROOM_VIEW", "GARDEN", "Garden view"], ["ROOM_VIEW", "LAGOON", "Lagoon view"],
    ["ROOM_AMENITY", "POOL", "Private pool"], ["ROOM_AMENITY", "MINIBAR", "Minibar"], ["ROOM_AMENITY", "WIFI", "Wi-Fi"],
    ["SPECIAL_REQUEST", "EARLY_CHECKIN", "Early check-in"], ["SPECIAL_REQUEST", "LATE_CHECKOUT", "Late check-out"], ["SPECIAL_REQUEST", "BABY_COT", "Baby cot"], ["SPECIAL_REQUEST", "HONEYMOON", "Honeymoon set-up"],
    ["TRANSPORT_TYPE", "SPEEDBOAT", "Speedboat"], ["TRANSPORT_TYPE", "SEAPLANE", "Seaplane"],
    ["HOUSEKEEPING_REQUEST", "TURNDOWN", "Turndown service"], ["HOUSEKEEPING_REQUEST", "EXTRA_TOWELS", "Extra towels"],
  ];
  const ensureCode = async (propertyId: string | null, [category, code, value]: string[], sortOrder: number) => {
    const found = await prisma.systemCode.findFirst({ where: { enterpriseId: enterprise.id, propertyId, category, code } });
    if (!found) await prisma.systemCode.create({ data: { enterpriseId: enterprise.id, propertyId, category, code, value, sortOrder } });
  };
  for (const [i, row] of guestLists.entries()) await ensureCode(null, row, i + 1);
  for (const [i, row] of propertyLists.entries()) await ensureCode(P, row, i + 1);

  // ── Finance ─────────────────────────────────────────────────────────────────────
  for (const m of [
    { name: "Cash", type: "CASH" },
    { name: "Visa / Mastercard", type: "CARD" },
    { name: "Bank Transfer", type: "TRANSFER" },
    { name: "City Ledger", type: "CITY_LEDGER" },
  ]) {
    await findOrCreate(
      () => prisma.paymentMethod.findFirst({ where: { propertyId: P, name: m.name } }),
      () => prisma.paymentMethod.create({ data: { enterpriseId: enterprise.id, propertyId: P, ...m } })
    );
  }
  const cityLedger = await prisma.paymentMethod.findFirstOrThrow({ where: { propertyId: P, type: "CITY_LEDGER" } });
  const code = async (c: string) => (await prisma.chargeCode.findUniqueOrThrow({ where: { propertyId_code: { propertyId: P, code: c } } })).id;

  // ── Outlets ─────────────────────────────────────────────────────────────────────
  const outlet = async (o: { code: string; name: string; outletType: string; codes: string[] }) => {
    const row = await findOrCreate(
      () => prisma.outlet.findFirst({ where: { propertyId: P, code: o.code } }),
      () => prisma.outlet.create({ data: { propertyId: P, code: o.code, name: o.name, outletType: o.outletType } })
    );
    for (const c of o.codes) {
      const chargeCodeId = await code(c);
      await prisma.outletChargeCode.upsert({
        where: { outletId_chargeCodeId: { outletId: row.id, chargeCodeId } },
        update: {},
        create: { outletId: row.id, chargeCodeId },
      });
    }
    return row;
  };
  await outlet({ code: "REEF", name: "Reef Restaurant", outletType: "RESTAURANT", codes: ["2001", "2002", "2003", "2004"] });
  await outlet({ code: "SUNBAR", name: "Sunset Bar", outletType: "BAR", codes: ["2004"] });
  const spaOutlet = await outlet({ code: "SPA", name: "Coral Spa", outletType: "SPA", codes: ["3001", "3002"] });
  const diveOutlet = await outlet({ code: "DIVE", name: "Dive & Excursions Desk", outletType: "RECREATION", codes: ["4001", "4002"] });
  for (const f of [
    { name: "Infinity pool", description: "Open 07:00–20:00" },
    { name: "Dive centre", description: "PADI courses and guided dives" },
    { name: "Kids' club", description: "Ages 4–12" },
  ]) {
    await findOrCreate(() => prisma.facility.findFirst({ where: { propertyId: P, name: f.name } }), () => prisma.facility.create({ data: { propertyId: P, ...f } }));
  }

  const settings = {
      cityLedgerPaymentMethodId: cityLedger.id,
      spaOutletId: spaOutlet.id,
      excursionOutletId: diveOutlet.id,
      invoiceHeaderText: "Thank you for staying with us.",
      invoiceFooterText: "We hope to welcome you back to Coral Bay soon.",
      invoicePaymentTerms: "Payment is due on receipt. Please quote the invoice number with your payment.",
      invoicePaymentAccountName: "Coral Bay Hospitality Pvt Ltd",
      invoicePaymentAccountNumber: "7700 0000 0000 0001",
      invoicePaymentBankInfo: "Example Bank, Main Branch",
      receiptFooterText: "Thank you.",
  };
  await prisma.propertySettings.upsert({ where: { propertyId: P }, update: settings, create: { propertyId: P, ...settings } });

  // ── Rooms & inventory ───────────────────────────────────────────────────────────
  const types = [
    { code: "GDN", name: "Garden Villa", max: 3, base: 2, features: [["BED_TYPE", "KING"], ["ROOM_VIEW", "GARDEN"], ["ROOM_AMENITY", "WIFI"]] },
    { code: "BCH", name: "Beach Villa", max: 3, base: 2, features: [["BED_TYPE", "KING"], ["ROOM_VIEW", "OCEAN"], ["ROOM_AMENITY", "WIFI"], ["ROOM_AMENITY", "MINIBAR"]] },
    { code: "WTR", name: "Water Villa with Pool", max: 4, base: 2, features: [["BED_TYPE", "KING"], ["ROOM_VIEW", "LAGOON"], ["ROOM_AMENITY", "POOL"], ["ROOM_AMENITY", "WIFI"]] },
  ];
  const typeIds: Record<string, string> = {};
  for (const t of types) {
    const rt = await findOrCreate(
      () => prisma.roomType.findFirst({ where: { propertyId: P, code: t.code } }),
      () =>
        prisma.roomType.create({
          data: {
            propertyId: P,
            code: t.code,
            name: t.name,
            maxOccupancy: t.max,
            baseOccupancy: t.base,
            features: { create: t.features.map(([category, c]) => ({ category, code: c })) },
          },
        })
    );
    typeIds[t.code] = rt.id;
  }
  const buildings: Array<{ name: string; floors: Array<{ name: string; rooms: Array<[string, string]> }> }> = [
    { name: "Garden Wing", floors: [{ name: "Ground", rooms: [["101", "GDN"], ["102", "GDN"], ["103", "GDN"], ["104", "GDN"]] }] },
    { name: "Beachfront", floors: [{ name: "Ground", rooms: [["201", "BCH"], ["202", "BCH"], ["203", "BCH"], ["204", "BCH"]] }] },
    { name: "Water Jetty", floors: [{ name: "Deck", rooms: [["301", "WTR"], ["302", "WTR"], ["303", "WTR"]] }] },
  ];
  for (const b of buildings) {
    const building = await findOrCreate(
      () => prisma.building.findFirst({ where: { propertyId: P, name: b.name } }),
      () => prisma.building.create({ data: { propertyId: P, name: b.name } })
    );
    for (const f of b.floors) {
      const floor = await findOrCreate(
        () => prisma.floor.findFirst({ where: { buildingId: building.id, name: f.name } }),
        () => prisma.floor.create({ data: { buildingId: building.id, name: f.name } })
      );
      for (const [roomNumber, t] of f.rooms) {
        await prisma.room.upsert({
          where: { propertyId_roomNumber: { propertyId: P, roomNumber } },
          update: {},
          create: { propertyId: P, floorId: floor.id, roomTypeId: typeIds[t], roomNumber, status: "CLEAN" },
        });
      }
    }
  }

  // ── Rates & packages ────────────────────────────────────────────────────────────
  const base = await prisma.ratePlan.findUniqueOrThrow({ where: { propertyId_code: { propertyId: P, code: "BASE" } } });
  if ((await prisma.priceCalendar.count({ where: { ratePlanId: base.id } })) === 0) {
    const price: Record<string, number> = { GDN: 220, BCH: 340, WTR: 560 };
    const start = new Date(resort.businessDate ?? new Date());
    const rows = [];
    for (const [t, p] of Object.entries(price)) {
      for (let d = 0; d < 365; d++) {
        const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + d));
        rows.push({ ratePlanId: base.id, roomTypeId: typeIds[t], date, price: p, extraAdultPrice: 60, extraChildPrice: 30 });
      }
    }
    await prisma.priceCalendar.createMany({ data: rows });
  }
  const bar = await prisma.ratePlan.upsert({
    where: { propertyId_code: { propertyId: P, code: "BAR" } },
    update: {},
    create: { propertyId: P, code: "BAR", name: "Best Available Rate", description: "Flexible, refundable", priority: 10 },
  });
  await prisma.ratePlan.upsert({
    where: { propertyId_code: { propertyId: P, code: "NRF" } },
    update: {},
    create: { propertyId: P, code: "NRF", name: "Non-Refundable", description: "10% below BAR", priority: 20, parentRatePlanId: bar.id, derivedAdjustmentType: "PERCENT", derivedAdjustmentValue: -10 },
  });
  await prisma.ratePlan.upsert({
    where: { propertyId_code: { propertyId: P, code: "CORP" } },
    update: {},
    create: { propertyId: P, code: "CORP", name: "Corporate Rate", priority: 30, isNegotiated: true },
  });
  if ((await prisma.priceCalendar.count({ where: { ratePlanId: bar.id } })) === 0) {
    const baseRows = await prisma.priceCalendar.findMany({ where: { ratePlanId: base.id } });
    await prisma.priceCalendar.createMany({
      data: baseRows.map((r) => ({ ratePlanId: bar.id, roomTypeId: r.roomTypeId, date: r.date, price: r.price + 30, extraAdultPrice: r.extraAdultPrice, extraChildPrice: r.extraChildPrice })),
    });
  }
  const allocIds: Record<string, string> = {};
  for (const a of [
    { code: "BF", name: "Breakfast", type: "FNB", charge: "2901", rhythm: "EVERY_NIGHT", adult: 25, child: 12 },
    { code: "DN", name: "Dinner", type: "FNB", charge: "2903", rhythm: "EVERY_NIGHT", adult: 55, child: 25 },
    { code: "LN", name: "Lunch", type: "FNB", charge: "2902", rhythm: "EVERY_NIGHT", adult: 40, child: 20, sellSeparate: true },
    { code: "TRF", name: "Speedboat transfer", type: "TRANSFER", charge: "5002", rhythm: "ARRIVAL_NIGHT", adult: 90, child: 45, sellSeparate: true },
  ]) {
    const row = await findOrCreate(
      () => prisma.allocation.findFirst({ where: { propertyId: P, code: a.code } }),
      async () =>
        prisma.allocation.create({
          data: {
            propertyId: P,
            code: a.code,
            name: a.name,
            type: a.type,
            chargeCodeId: await code(a.charge),
            postingRhythm: a.rhythm,
            mode: "ADD_TO_RATE",
            sellSeparate: a.sellSeparate ?? false,
            rates: { create: { adultPrice: a.adult, childPrice: a.child, effectiveFrom: EFFECTIVE } },
          },
        })
    );
    allocIds[a.code] = row.id;
  }
  for (const mp of [
    { code: "BB", name: "Bed & Breakfast", allocs: ["BF"] },
    { code: "HB", name: "Half Board", allocs: ["BF", "DN"] },
    { code: "FB", name: "Full Board", allocs: ["BF", "LN", "DN"] },
  ]) {
    const plan = await prisma.mealPlan.upsert({
      where: { propertyId_code: { propertyId: P, code: mp.code } },
      update: {},
      create: { propertyId: P, code: mp.code, name: mp.name },
    });
    for (const a of mp.allocs) {
      await prisma.mealPlanAllocation.upsert({
        where: { mealPlanId_allocationId: { mealPlanId: plan.id, allocationId: allocIds[a] } },
        update: {},
        create: { mealPlanId: plan.id, allocationId: allocIds[a] },
      });
    }
  }

  // ── Online booking: the website sells BAR, guests pick their meal plan ─────────────
  const website = {
    ratePlanId: bar.id,
    offerMealPlans: true,
    headline: "Barefoot luxury on a quiet lagoon",
    description: "Villas on the beach and over the water, a house reef and a spa.",
    policies: "Free cancellation up to 14 days before arrival.",
  };
  await prisma.websitePropertySettings.upsert({ where: { propertyId: P }, update: website, create: { propertyId: P, ...website } });

  // ── Excursions ──────────────────────────────────────────────────────────────────
  for (const x of [
    { code: "SNORK", name: "Reef Snorkelling", adult: 55, child: 30, days: "MON,WED,FRI", time: "09:00", capacity: 12 },
    { code: "SUNSET", name: "Sunset Dolphin Cruise", adult: 80, child: 40, days: "TUE,THU,SAT", time: "17:00", capacity: 20 },
  ]) {
    const type = await findOrCreate(
      () => prisma.excursionType.findFirst({ where: { propertyId: P, code: x.code } }),
      async () =>
        prisma.excursionType.create({
          data: {
            propertyId: P,
            code: x.code,
            name: x.name,
            chargeCodeId: await code("4001"),
            cutoffHours: 24,
            rates: { create: [{ adultPrice: x.adult, childPrice: x.child, infantPrice: 0, effectiveFrom: EFFECTIVE }] },
          },
        })
    );
    const schedule = await findOrCreate(
      () => prisma.excursionSchedule.findFirst({ where: { excursionTypeId: type.id } }),
      () =>
        prisma.excursionSchedule.create({
          data: { excursionTypeId: type.id, daysOfWeek: x.days, departureTime: x.time, meetingTime: x.time, meetingPoint: "Main Jetty", capacity: x.capacity, minCapacity: 4 },
        })
    );
    if ((await prisma.excursionDeparture.count({ where: { excursionTypeId: type.id } })) === 0) {
      const from = new Date();
      for (const departureDate of expandScheduleDates(schedule.daysOfWeek, from, new Date(from.getTime() + 60 * 864e5))) {
        await prisma.excursionDeparture.create({
          data: {
            excursionTypeId: type.id,
            scheduleId: schedule.id,
            departureDate,
            departureTime: schedule.departureTime,
            meetingTime: schedule.meetingTime,
            meetingPoint: schedule.meetingPoint,
            capacity: schedule.capacity,
            minCapacity: schedule.minCapacity,
          },
        });
      }
    }
  }

  // ── Spa ─────────────────────────────────────────────────────────────────────────
  const category = await findOrCreate(
    () => prisma.spaTreatmentCategory.findFirst({ where: { propertyId: P, name: "Massage" } }),
    () => prisma.spaTreatmentCategory.create({ data: { propertyId: P, name: "Massage", description: "Relaxing and therapeutic massages" } })
  );
  await findOrCreate(
    () => prisma.spaTreatmentCategory.findFirst({ where: { propertyId: P, name: "Facials" } }),
    () => prisma.spaTreatmentCategory.create({ data: { propertyId: P, name: "Facials", description: "Skin care" } })
  );
  const treatments = [];
  for (const t of [
    { name: "Balinese Massage", duration: 60, price: 120, max: 1 },
    { name: "Couples Massage", duration: 90, price: 300, max: 2 },
  ]) {
    treatments.push(
      await findOrCreate(
        () => prisma.spaTreatment.findFirst({ where: { propertyId: P, name: t.name } }),
        async () =>
          prisma.spaTreatment.create({
            data: {
              propertyId: P,
              categoryId: category.id,
              name: t.name,
              defaultDurationMinutes: t.duration,
              cleanupBufferMinutes: 15,
              chargeCodeId: await code("3001"),
              maxParticipants: t.max,
              pricingMode: t.max > 1 ? "FLAT" : "PER_PERSON",
              rates: { create: [{ price: t.price, effectiveFrom: EFFECTIVE }] },
            },
          })
      )
    );
  }
  for (const th of [
    { name: "Laila Ahmed", gender: "FEMALE" },
    { name: "Ravi Kumar", gender: "MALE" },
  ]) {
    const therapist = await findOrCreate(
      () => prisma.spaTherapist.findFirst({ where: { propertyId: P, displayName: th.name } }),
      () => prisma.spaTherapist.create({ data: { propertyId: P, displayName: th.name, gender: th.gender } })
    );
    if (!(await prisma.spaTherapistSchedule.findFirst({ where: { therapistId: therapist.id } }))) {
      await prisma.spaTherapistSchedule.createMany({
        data: [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ therapistId: therapist.id, dayOfWeek, startTime: "09:00", endTime: "18:00", effectiveFrom: EFFECTIVE })),
      });
    }
    for (const t of treatments) {
      await prisma.spaTherapistTreatment.upsert({
        where: { therapistId_treatmentId: { therapistId: therapist.id, treatmentId: t.id } },
        update: {},
        create: { therapistId: therapist.id, treatmentId: t.id, qualified: true },
      });
    }
  }
  for (const r of [
    { name: "Treatment Room 1", capacity: 1 },
    { name: "Couples Suite", capacity: 2 },
  ]) {
    await findOrCreate(() => prisma.spaRoom.findFirst({ where: { propertyId: P, name: r.name } }), () => prisma.spaRoom.create({ data: { propertyId: P, ...r } }));
  }
  await prisma.spaSettings.upsert({ where: { propertyId: P }, update: {}, create: { propertyId: P, defaultOpeningTime: "09:00", defaultClosingTime: "20:00" } });

  console.log(`docs:demo — Coral Bay Hotels ready. Enterprise code "${DEMO.slug}", admin ${admin.email}.`);
  console.log(`  ${DEMO.resort}  Coral Bay Resort  ${resort.id}  (set up)`);
  console.log(`  ${DEMO.lodge}  Coral Bay Lodge   ${lodge.id}  (as provisioned)`);
}

main()
  .catch((e) => {
    console.error("docs:demo failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
