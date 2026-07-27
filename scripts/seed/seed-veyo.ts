import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { SYSTEM_ROLE_DEFS, SUPPORT_ROLE_DEFS, ensureRoles } from "../../prisma/rbac-seed-data";
import { expandScheduleDates } from "../../src/lib/excursions";
import { ensureChargeTree } from "../../src/lib/posting/ensure-charge-tree";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  // 1. Osta INTERNAL enterprise + shared system/support roles.
  const osta = await prisma.enterprise.upsert({
    where: { slug: "osta" },
    update: {},
    create: { name: "Osta", slug: "osta", type: "INTERNAL" },
  });
  const systemRoleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
  const supportRoleIds = await ensureRoles(prisma, osta.id, SUPPORT_ROLE_DEFS, true);
  await prisma.user.upsert({
    where: { email: "support@osta.internal" },
    update: {},
    create: {
      enterpriseId: osta.id,
      email: "support@osta.internal",
      passwordHash,
      firstName: "Osta",
      lastName: "Support",
      roleId: supportRoleIds["Osta Support Admin"],
      scope: "ENTERPRISE",
    },
  });

  // 2. Veyo enterprise + license.
  const veyo = await prisma.enterprise.upsert({
    where: { slug: "veyo" },
    update: {},
    create: { name: "Veyo", slug: "veyo", type: "STANDARD" },
  });
  await prisma.enterpriseLicense.upsert({
    where: { enterpriseId: veyo.id },
    update: {},
    create: { enterpriseId: veyo.id, tier: "MAX", maxProperties: 5 },
  });
  await prisma.enterpriseSettings.upsert({
    where: { enterpriseId: veyo.id },
    update: {},
    create: { enterpriseId: veyo.id },
  });

  // 3. Users.
  const admin = await prisma.user.upsert({
    where: { email: "admin@veyo.com" },
    update: {},
    create: {
      enterpriseId: veyo.id,
      email: "admin@veyo.com",
      passwordHash,
      firstName: "Veyo",
      lastName: "Admin",
      roleId: systemRoleIds["Admin"],
      scope: "ENTERPRISE",
    },
  });
  await prisma.user.upsert({
    where: { email: "frontdesk@veyo.com" },
    update: {},
    create: {
      enterpriseId: veyo.id,
      email: "frontdesk@veyo.com",
      passwordHash,
      firstName: "Fatima",
      lastName: "Desk",
      roleId: systemRoleIds["Front Desk"],
      scope: "ENTERPRISE",
    },
  });
  await prisma.user.upsert({
    where: { email: "housekeeping@veyo.com" },
    update: {},
    create: {
      enterpriseId: veyo.id,
      email: "housekeeping@veyo.com",
      passwordHash,
      firstName: "Aisha",
      lastName: "Maid",
      roleId: systemRoleIds["Housekeeping"],
      scope: "ENTERPRISE",
    },
  });

  // 4. Property, building, floors.
  const property = await prisma.property.upsert({
    where: { code: "VEYO-MAIN" },
    update: {},
    create: {
      enterpriseId: veyo.id,
      name: "Veyo Beach Resort",
      legalName: "Veyo Hospitality Pvt Ltd",
      code: "VEYO-MAIN",
      defaultCurrency: "USD",
      timeZone: "Indian/Maldives",
      checkInTime: "14:00",
      checkOutTime: "12:00",
      contactEmail: "frontdesk@veyo.com",
      contactPhone: "+960 555 0100",
    },
  });

  let building = await prisma.building.findFirst({ where: { propertyId: property.id } });
  if (!building) {
    building = await prisma.building.create({ data: { propertyId: property.id, name: "Main Building" } });
  }
  let floor = await prisma.floor.findFirst({ where: { buildingId: building.id } });
  if (!floor) {
    floor = await prisma.floor.create({ data: { buildingId: building.id, name: "Ground Floor" } });
  }

  // 5. Room types + rooms.
  const deluxe =
    (await prisma.roomType.findFirst({ where: { propertyId: property.id, code: "DLX" } })) ||
    (await prisma.roomType.create({
      data: { propertyId: property.id, name: "Deluxe Beach Villa", code: "DLX", maxOccupancy: 2 },
    }));
  const suite =
    (await prisma.roomType.findFirst({ where: { propertyId: property.id, code: "STE" } })) ||
    (await prisma.roomType.create({
      data: { propertyId: property.id, name: "Overwater Suite", code: "STE", maxOccupancy: 4 },
    }));

  const rooms = [
    { roomTypeId: deluxe.id, roomNumber: "101" },
    { roomTypeId: deluxe.id, roomNumber: "102" },
    { roomTypeId: deluxe.id, roomNumber: "103" },
    { roomTypeId: suite.id, roomNumber: "201" },
    { roomTypeId: suite.id, roomNumber: "202" },
  ];
  for (const r of rooms) {
    await prisma.room.upsert({
      where: { propertyId_roomNumber: { propertyId: property.id, roomNumber: r.roomNumber } },
      update: {},
      create: { propertyId: property.id, floorId: floor.id, status: "CLEAN", ...r },
    });
  }

  // 6. Rate plans. Every property gets a locked "Base Rate" at onboarding (see
  // RatePlan.isLocked) — the default price for any room type/date when nothing
  // custom applies. This seed backfills its Price Calendar for today through a
  // year out so Night Audit and the demo both have real fallback pricing.
  const baseRate = await prisma.ratePlan.upsert({
    where: { propertyId_code: { propertyId: property.id, code: "BASE" } },
    update: {},
    create: { propertyId: property.id, code: "BASE", name: "Base Rate", priority: 999, isLocked: true },
  });
  const existingBaseCalendarCount = await prisma.priceCalendar.count({ where: { ratePlanId: baseRate.id } });
  if (existingBaseCalendarCount === 0) {
    const basePrices: Record<string, number> = { [deluxe.id]: 250, [suite.id]: 450 };
    const rows: Array<{ ratePlanId: string; roomTypeId: string; date: Date; price: number }> = [];
    for (const [roomTypeId, price] of Object.entries(basePrices)) {
      for (let d = 0; d < 365; d++) {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() + d);
        rows.push({ ratePlanId: baseRate.id, roomTypeId, date, price });
      }
    }
    await prisma.priceCalendar.createMany({ data: rows });
  }

  const bar = await prisma.ratePlan.upsert({
    where: { propertyId_code: { propertyId: property.id, code: "BAR" } },
    update: {},
    create: { propertyId: property.id, code: "BAR", name: "Best Available Rate", description: "Standard flexible rate" },
  });
  await prisma.ratePlan.upsert({
    where: { propertyId_code: { propertyId: property.id, code: "NRF" } },
    update: {},
    create: { propertyId: property.id, code: "NRF", name: "Non-Refundable", description: "Discounted non-refundable rate" },
  });

  // 7. Tax profile + charge codes + payment methods.
  let taxProfile = await prisma.taxProfile.findFirst({ where: { enterpriseId: veyo.id } });
  if (!taxProfile) {
    taxProfile = await prisma.taxProfile.create({
      data: {
        enterpriseId: veyo.id,
        name: "Standard Taxes",
        rates: { create: [{ ratePercent: 16, effectiveFrom: new Date("2020-01-01") }] },
      },
    });
  }
  await ensureChargeTree(prisma, veyo.id);
  const subgroups = await prisma.chargeSubgroup.findMany({ where: { enterpriseId: veyo.id } });
  const subgroupId = (code: string) => subgroups.find((s) => s.code === code)!.id;

  const rmCode = await prisma.chargeCode.upsert({
    where: { enterpriseId_code: { enterpriseId: veyo.id, code: "RM" } },
    update: {},
    create: { enterpriseId: veyo.id, code: "RM", description: "Room Charge", chargeSubgroupId: subgroupId("ROOM_REVENUE"), taxProfileId: taxProfile.id },
  });
  const fbCode = await prisma.chargeCode.upsert({
    where: { enterpriseId_code: { enterpriseId: veyo.id, code: "FB" } },
    update: {},
    create: { enterpriseId: veyo.id, code: "FB", description: "Food & Beverage", chargeSubgroupId: subgroupId("RESTAURANT"), taxProfileId: taxProfile.id },
  });

  // The canonical Charge Group -> Subgroup -> Code tree (the same one property
  // onboarding creates), including the system ROOM / GTX / COMM codes and the
  // ROOM -> Green Tax generate. Everything below classifies into it.

  // Sample chart of charge codes, classified by Subgroup rather than the deprecated
  // hierarchy. Spa has a real home (OTHER / SPA) instead of being
  // lumped into "OTHERS". All use the enterprise default tax engine. (No PAYMENT bucket
  // — payment types are Payment Methods, seeded below.)
  const sampleChargeCodes: Array<{ code: string; description: string; subgroup: string; postingType?: string }> = [
    // Accommodation
    { code: "10RV", description: "Accommodation Revenue", subgroup: "ROOM_REVENUE" },
    { code: "11RV", description: "Accommodation Upgrade", subgroup: "ROOM_REVENUE" },
    { code: "13RV", description: "Cancellation Penalty", subgroup: "ROOM_REVENUE" },
    { code: "14RV", description: "Noshow Penalty", subgroup: "ROOM_REVENUE" },
    // F&B
    { code: "60RV", description: "Package Breakfast", subgroup: "MEAL_PLAN" },
    { code: "61RV", description: "Package Lunch", subgroup: "MEAL_PLAN" },
    { code: "62RV", description: "Package Dinner", subgroup: "MEAL_PLAN" },
    // Transport
    { code: "50RV", description: "Airport Transfer", subgroup: "TRANSFERS" },
    { code: "51RV", description: "SpeedBoat Transfer", subgroup: "TRANSFERS" },
    // Spa
    { code: "40RV", description: "Spa Massage", subgroup: "SPA" },
    { code: "41RV", description: "Spa Treatment", subgroup: "SPA" },
    { code: "49RV", description: "Spa Misc", subgroup: "SPA" },
  ];
  const chargeCodeByCode: Record<string, string> = {};
  for (const cc of sampleChargeCodes) {
    const created = await prisma.chargeCode.upsert({
      where: { enterpriseId_code: { enterpriseId: veyo.id, code: cc.code } },
      update: { chargeSubgroupId: subgroupId(cc.subgroup) },
      create: {
        enterpriseId: veyo.id,
        code: cc.code,
        description: cc.description,
        chargeSubgroupId: subgroupId(cc.subgroup),
        postingType: cc.postingType ?? "CHARGE",
      },
    });
    chargeCodeByCode[cc.code] = created.id;
  }
  // GTX comes from the seeded tree now (postingType TAX, so it posts at face value and
  // stays out of the GST base) rather than being hand-created here.
  const gtxCode = await prisma.chargeCode.findUniqueOrThrow({
    where: { enterpriseId_code: { enterpriseId: veyo.id, code: "GTX" } },
  });
  chargeCodeByCode["GTX"] = gtxCode.id;

  // 10RV is the property's real accommodation code, so it — not just the system ROOM
  // code — is what must levy the nightly Green Tax. This is the same row the charge-code
  // API seeds automatically when a new ACCOMMODATION-bucket code is added in Controls.
  await prisma.chargeCodeGenerate.upsert({
    where: { generatorCodeId_generatedCodeId: { generatorCodeId: chargeCodeByCode["10RV"], generatedCodeId: gtxCode.id } },
    update: {},
    create: {
      enterpriseId: veyo.id,
      generatorCodeId: chargeCodeByCode["10RV"],
      generatedCodeId: gtxCode.id,
      method: "GREEN_TAX",
      value: 0,
      calculateOn: "NET",
      sortOrder: 10,
    },
  });

  let pmCard = await prisma.paymentMethod.findFirst({ where: { enterpriseId: veyo.id, type: "CARD" } });
  if (!pmCard) pmCard = await prisma.paymentMethod.create({ data: { enterpriseId: veyo.id, name: "Credit Card", type: "CARD" } });
  const pmCash = await prisma.paymentMethod.findFirst({ where: { enterpriseId: veyo.id, type: "CASH" } });
  if (!pmCash) await prisma.paymentMethod.create({ data: { enterpriseId: veyo.id, name: "Cash", type: "CASH" } });
  const pmTransfer = await prisma.paymentMethod.findFirst({ where: { enterpriseId: veyo.id, type: "TRANSFER" } });
  if (!pmTransfer) await prisma.paymentMethod.create({ data: { enterpriseId: veyo.id, name: "Bank Transfer", type: "TRANSFER" } });
  let pmCityLedger = await prisma.paymentMethod.findFirst({ where: { enterpriseId: veyo.id, type: "CITY_LEDGER" } });
  if (!pmCityLedger) pmCityLedger = await prisma.paymentMethod.create({ data: { enterpriseId: veyo.id, name: "City Ledger", type: "CITY_LEDGER" } });

  // Role -> charge code pointers (Controls > Cashiering > Posting Defaults). These are
  // what resolveChargeCode() reads, so the runtime never looks a code up by name. The
  // City Ledger method (Controls > Finance) settles debtor-account folios at checkout.
  await prisma.enterpriseSettings.update({
    where: { enterpriseId: veyo.id },
    data: {
      defaultAccommodationChargeCodeId: chargeCodeByCode["10RV"],
      defaultGreenTaxChargeCodeId: gtxCode.id,
      cityLedgerPaymentMethodId: pmCityLedger.id,
    },
  });

  // 7b. Allocations (per-person priced components — see .agents/docs/ALLOCATIONS_PLAN.md),
  // each posting against its own dedicated charge code (Package Breakfast/Lunch/Dinner,
  // the transfer codes) rather than the generic FB catch-all, so revenue reports break
  // down by meal/service. Upserts so re-seeding repoints an existing allocation's
  // charge code. Rate rows are only created when the allocation is first inserted.
  const seedAllocation = async (opts: {
    code: string; name: string; type: string; chargeCode: string; postingRhythm: string;
    mode?: string; sellSeparate?: boolean; adultPrice: number; childPrice: number;
  }) => {
    const existing = await prisma.allocation.findFirst({ where: { propertyId: property.id, code: opts.code } });
    if (existing) {
      return prisma.allocation.update({
        where: { id: existing.id },
        data: { chargeCodeId: chargeCodeByCode[opts.chargeCode] },
      });
    }
    return prisma.allocation.create({
      data: {
        propertyId: property.id,
        code: opts.code,
        name: opts.name,
        type: opts.type,
        chargeCodeId: chargeCodeByCode[opts.chargeCode],
        postingRhythm: opts.postingRhythm,
        mode: opts.mode ?? "ADD_TO_RATE",
        sellSeparate: opts.sellSeparate ?? false,
        rates: { create: { adultPrice: opts.adultPrice, childPrice: opts.childPrice, effectiveFrom: new Date("2026-01-01") } },
      },
    });
  };
  const bfAllocation = await seedAllocation({ code: "BF", name: "Breakfast", type: "FNB", chargeCode: "60RV", postingRhythm: "EVERY_NIGHT", adultPrice: 10, childPrice: 5 });
  const lnAllocation = await seedAllocation({ code: "LN", name: "Lunch", type: "FNB", chargeCode: "61RV", postingRhythm: "EVERY_NIGHT", sellSeparate: true, adultPrice: 20, childPrice: 10 });
  const dnAllocation = await seedAllocation({ code: "DN", name: "Dinner", type: "FNB", chargeCode: "62RV", postingRhythm: "EVERY_NIGHT", adultPrice: 30, childPrice: 15 });
  await seedAllocation({ code: "TRF-AIR", name: "Airport Transfer", type: "TRANSFER", chargeCode: "50RV", postingRhythm: "ARRIVAL_NIGHT", sellSeparate: true, adultPrice: 40, childPrice: 20 });
  await seedAllocation({ code: "TRF-SB", name: "Speedboat Transfer", type: "TRANSFER", chargeCode: "51RV", postingRhythm: "ARRIVAL_NIGHT", sellSeparate: true, adultPrice: 50, childPrice: 25 });
  void lnAllocation;

  const bbPlan = await prisma.mealPlan.upsert({
    where: { propertyId_code: { propertyId: property.id, code: "BB" } },
    update: {},
    create: { propertyId: property.id, code: "BB", name: "Bed & Breakfast" },
  });
  await prisma.mealPlanAllocation.upsert({
    where: { mealPlanId_allocationId: { mealPlanId: bbPlan.id, allocationId: bfAllocation.id } },
    update: {},
    create: { mealPlanId: bbPlan.id, allocationId: bfAllocation.id },
  });
  const hbPlan = await prisma.mealPlan.upsert({
    where: { propertyId_code: { propertyId: property.id, code: "HB" } },
    update: {},
    create: { propertyId: property.id, code: "HB", name: "Half Board" },
  });
  for (const allocId of [bfAllocation.id, dnAllocation.id]) {
    await prisma.mealPlanAllocation.upsert({
      where: { mealPlanId_allocationId: { mealPlanId: hbPlan.id, allocationId: allocId } },
      update: {},
      create: { mealPlanId: hbPlan.id, allocationId: allocId },
    });
  }
  // 8. System codes (LOVs).
  const systemCodes = [
    { category: "GENDER", code: "M", value: "Male", sortOrder: 1 },
    { category: "GENDER", code: "F", value: "Female", sortOrder: 2 },
    { category: "TITLE", code: "MR", value: "Mr", sortOrder: 1 },
    { category: "TITLE", code: "MRS", value: "Mrs", sortOrder: 2 },
    { category: "TITLE", code: "MS", value: "Ms", sortOrder: 3 },
    { category: "NATIONALITY", code: "MV", value: "Maldivian", sortOrder: 1 },
    { category: "NATIONALITY", code: "US", value: "American", sortOrder: 2 },
    { category: "NATIONALITY", code: "GB", value: "British", sortOrder: 3 },
    { category: "ID_TYPE", code: "PASSPORT", value: "Passport", sortOrder: 1 },
    // Profiles redesign (2026-07-20) — VIP Level replaces the old free-text Loyalty
    // Tier; Preferences is a new general multi-select distinct from Dietary/Room prefs.
    { category: "VIP_LEVEL", code: "SILVER", value: "Silver", sortOrder: 1 },
    { category: "VIP_LEVEL", code: "GOLD", value: "Gold", sortOrder: 2 },
    { category: "VIP_LEVEL", code: "PLATINUM", value: "Platinum", sortOrder: 3 },
    { category: "PREFERENCE", code: "HIGH_FLOOR", value: "High Floor", sortOrder: 1 },
    { category: "PREFERENCE", code: "QUIET_ROOM", value: "Quiet Room", sortOrder: 2 },
    { category: "PREFERENCE", code: "EXTRA_PILLOWS", value: "Extra Pillows", sortOrder: 3 },
    { category: "PREFERENCE", code: "NON_SMOKING", value: "Non-Smoking", sortOrder: 4 },
    { category: "DIETARY_REQ", code: "VEGAN", value: "Vegan", sortOrder: 1 },
    { category: "DIETARY_REQ", code: "VEGETARIAN", value: "Vegetarian", sortOrder: 2 },
    { category: "DIETARY_REQ", code: "GLUTEN_FREE", value: "Gluten-Free", sortOrder: 3 },
    { category: "DIETARY_REQ", code: "HALAL", value: "Halal", sortOrder: 4 },
    { category: "CLASSIFICATION", code: "VIP", value: "VIP", sortOrder: 1 },
    { category: "CLASSIFICATION", code: "REGULAR", value: "Regular", sortOrder: 2 },
    { category: "CLASSIFICATION", code: "BLACKLISTED", value: "Blacklisted", sortOrder: 3 },
    // Reservation-level Special Requests (Controls > Reservations), selectable as
    // chips on the booking dialog — see ReservationSpecialRequest.
    { category: "SPECIAL_REQUEST", code: "HIGH_FLOOR", value: "High Floor", sortOrder: 1 },
    { category: "SPECIAL_REQUEST", code: "EARLY_CHECKIN", value: "Early Check-in", sortOrder: 2 },
    { category: "SPECIAL_REQUEST", code: "LATE_CHECKOUT", value: "Late Checkout", sortOrder: 3 },
    { category: "SPECIAL_REQUEST", code: "AIRPORT_PICKUP", value: "Airport Pickup", sortOrder: 4 },
    { category: "SPECIAL_REQUEST", code: "BABY_COT", value: "Baby Cot", sortOrder: 5 },
  ];
  for (const sc of systemCodes) {
    await prisma.systemCode.upsert({
      where: { enterpriseId_category_code: { enterpriseId: veyo.id, category: sc.category, code: sc.code } },
      update: {},
      create: { enterpriseId: veyo.id, ...sc },
    });
  }

  // 9. Guest profiles.
  const guestData = [
    { firstName: "John", lastName: "Smith", title: "MR", gender: "M", country: "US" },
    { firstName: "Mary", lastName: "Davis", title: "MRS", gender: "F", country: "GB", vipLevel: "GOLD" },
    { firstName: "David", lastName: "Williams", title: "MR", gender: "M", country: "AU" },
    { firstName: "Jennifer", lastName: "Wilson", title: "MRS", gender: "F", country: "US" },
    { firstName: "Michael", lastName: "Johnson", title: "MR", gender: "M", country: "MV" },
  ];
  const profiles = [];
  for (const g of guestData) {
    let profile = await prisma.profile.findFirst({
      where: { enterpriseId: veyo.id, firstName: g.firstName, lastName: g.lastName },
    });
    if (!profile) {
      profile = await prisma.profile.create({
        data: {
          enterpriseId: veyo.id,
          profileType: "GUEST",
          title: g.title,
          firstName: g.firstName,
          lastName: g.lastName,
          gender: g.gender,
          nationality: g.country,
          preferredLanguage: "en",
          vipLevel: g.vipLevel ?? null,
          originPropertyId: property.id,
          communications: {
            create: [
              {
                type: "EMAIL",
                value: `${g.firstName.toLowerCase()}.${g.lastName.toLowerCase()}@example.com`,
                isPrimary: true,
              },
            ],
          },
          addresses: {
            create: [
              { type: "HOME", fullAddress: "", country: g.country, isPrimary: true },
            ],
          },
        },
      });
      // A sample note + attachment + preference tag on the VIP guest, so the CRM
      // sections have something to show out of the box.
      if (g.vipLevel) {
        await prisma.profileNote.create({
          data: { upid: profile.upid, authorUserId: admin.id, noteText: "Repeat guest — always requests late checkout.", isPinned: true },
        });
        await prisma.profileAttachment.create({
          data: { upid: profile.upid, label: "Signed registration card", url: "https://example.com/docs/registration-card.pdf" },
        });
        await prisma.profilePreference.create({ data: { upid: profile.upid, category: "PREFERENCE", value: "HIGH_FLOOR" } });
      }
    }
    profiles.push(profile);
  }

  // A Staff profile (see .agents/docs/PROFILES_REDESIGN_PLAN.md) — same shape as
  // Guest, no relation to the User/login model.
  const staffExists = await prisma.profile.findFirst({ where: { enterpriseId: veyo.id, profileType: "STAFF", firstName: "Aisha" } });
  if (!staffExists) {
    await prisma.profile.create({
      data: {
        enterpriseId: veyo.id,
        profileType: "STAFF",
        firstName: "Aisha",
        lastName: "Naeem",
        gender: "F",
        nationality: "MV",
        originPropertyId: property.id,
        communications: { create: [{ type: "EMAIL", value: "aisha.naeem@veyo.example.com", isPrimary: true }] },
      },
    });
  }

  // 10. Reservations across a few scenarios (future / in-house / checked-out).
  const genConf = () => "RES" + Math.floor(100000 + Math.random() * 900000).toString();
  const roomsInDb = await prisma.room.findMany({ where: { propertyId: property.id } });

  const existingResCount = await prisma.reservation.count({ where: { propertyId: property.id } });
  if (existingResCount === 0) {
    await prisma.reservation.create({
      data: {
        confirmationNo: genConf(),
        propertyId: property.id,
        primaryGuestId: profiles[0].upid,
        checkInDate: new Date(new Date().setMonth(new Date().getMonth() + 1)),
        checkOutDate: new Date(new Date().setMonth(new Date().getMonth() + 1, new Date().getDate() + 3)),
        status: "RESERVED",
      },
    });

    const shift = await prisma.cashierShift.create({ data: { enterpriseId: veyo.id, userId: admin.id } });

    for (let i = 1; i <= 2; i++) {
      await prisma.reservation.create({
        data: {
          confirmationNo: genConf(),
          propertyId: property.id,
          primaryGuestId: profiles[i].upid,
          checkInDate: new Date(new Date().setDate(new Date().getDate() - i)),
          checkOutDate: new Date(new Date().setDate(new Date().getDate() + 2)),
          status: "IN_HOUSE",
          assignments: {
            create: [
              {
                roomId: roomsInDb[i].id,
                roomTypeId: roomsInDb[i].roomTypeId,
                ratePlanId: bar.id,
                startDate: new Date(new Date().setDate(new Date().getDate() - i)),
                endDate: new Date(new Date().setDate(new Date().getDate() + 2)),
                overrideRate: 250,
              },
            ],
          },
          folios: {
            create: [
              {
                folioNumber: 1,
                propertyId: property.id,
                lineItems: {
                  create: [
                    { chargeCodeId: rmCode.id, date: new Date(), description: "Room Charge", amount: 250, taxAmount: 40, serviceChargeAmount: 25 },
                    { chargeCodeId: fbCode.id, date: new Date(), description: "Dinner Restaurant", amount: 85, taxAmount: 13.6, serviceChargeAmount: 8.5 },
                  ],
                },
              },
            ],
          },
        },
      });
      await prisma.room.update({ where: { id: roomsInDb[i].id }, data: { status: "DIRTY" } });
    }

    for (let i = 3; i <= 4; i++) {
      await prisma.reservation.create({
        data: {
          confirmationNo: genConf(),
          propertyId: property.id,
          primaryGuestId: profiles[i].upid,
          checkInDate: new Date(new Date().setDate(new Date().getDate() - 15 - i)),
          checkOutDate: new Date(new Date().setDate(new Date().getDate() - 10 - i)),
          status: "CHECKED_OUT",
          assignments: {
            create: [
              {
                roomId: roomsInDb[0].id,
                roomTypeId: roomsInDb[0].roomTypeId,
                ratePlanId: bar.id,
                startDate: new Date(new Date().setDate(new Date().getDate() - 15 - i)),
                endDate: new Date(new Date().setDate(new Date().getDate() - 10 - i)),
                overrideRate: 250,
              },
            ],
          },
          folios: {
            create: [
              {
                folioNumber: 1,
                propertyId: property.id,
                isClosed: true,
                lineItems: {
                  create: [{ chargeCodeId: rmCode.id, date: new Date(), description: "Room Charge", amount: 1250, taxAmount: 200, serviceChargeAmount: 125 }],
                },
                payments: { create: [{ paymentMethodId: pmCard.id, shiftId: shift.id, amount: 1575 }] },
              },
            ],
          },
        },
      });
      await prisma.profile.update({
        where: { upid: profiles[i].upid },
        data: {
          totalStays: { increment: 1 },
          totalNights: { increment: 5 },
          totalRevenue: { increment: 1575 },
          lastStayDate: new Date(new Date().setDate(new Date().getDate() - 10 - i)),
        },
      });
    }
  }

  // 11. Excursions Booking add-on (see .agents/docs/EXCURSIONS_PLAN.md) — Osta-enabled
  // for this property (defaults OFF everywhere else, same as a real customer would need
  // it turned on via /osta/properties/[id]), a small chart of excursion types with
  // dated pricing, one recurring schedule each, and departures generated ~60 days out —
  // so the feature has real, clickable data immediately after seeding, not just an
  // empty Controls tab.
  await prisma.propertyModuleAccess.upsert({
    where: { propertyId_module: { propertyId: property.id, module: "EXCURSIONS" } },
    update: { enabled: true },
    create: { propertyId: property.id, module: "EXCURSIONS", enabled: true },
  });

  const excursionChargeCodes: Array<{ code: string; description: string }> = [
    { code: "70RV", description: "Snorkelling Trip Revenue" },
    { code: "71RV", description: "Island Hopping Revenue" },
    { code: "72RV", description: "Night Fishing Revenue" },
  ];
  const excursionChargeCodeByCode: Record<string, string> = {};
  for (const cc of excursionChargeCodes) {
    const created = await prisma.chargeCode.upsert({
      where: { enterpriseId_code: { enterpriseId: veyo.id, code: cc.code } },
      update: {},
      create: { enterpriseId: veyo.id, code: cc.code, description: cc.description, chargeSubgroupId: subgroupId("EXCURSION_TOUR") },
    });
    excursionChargeCodeByCode[cc.code] = created.id;
  }

  const excursionDefs: Array<{
    code: string;
    name: string;
    description: string;
    chargeCode: string;
    cutoffHours: number;
    adultPrice: number;
    childPrice: number;
    daysOfWeek: string;
    departureTime: string;
    meetingTime: string;
    meetingPoint: string;
    capacity: number;
    minCapacity: number;
  }> = [
    {
      code: "SNORK", name: "Snorkelling Trip", description: "Guided reef snorkelling excursion",
      chargeCode: "70RV", cutoffHours: 24, adultPrice: 50, childPrice: 25,
      daysOfWeek: "MON,WED,FRI", departureTime: "09:00", meetingTime: "08:45", meetingPoint: "Main Jetty",
      capacity: 12, minCapacity: 4,
    },
    {
      code: "ISLE", name: "Island Hopping", description: "Half-day tour of neighbouring islands",
      chargeCode: "71RV", cutoffHours: 24, adultPrice: 75, childPrice: 35,
      daysOfWeek: "TUE,SAT", departureTime: "10:00", meetingTime: "09:45", meetingPoint: "Main Jetty",
      capacity: 16, minCapacity: 6,
    },
    {
      // Shorter cutoff than the others — a same-evening trip, so a same-day booking
      // shouldn't be blocked by a 24h window the way the daytime trips are.
      code: "NFISH", name: "Night Fishing", description: "Traditional evening hand-line fishing trip",
      chargeCode: "72RV", cutoffHours: 12, adultPrice: 60, childPrice: 30,
      daysOfWeek: "THU,SAT", departureTime: "18:00", meetingTime: "17:45", meetingPoint: "Main Jetty",
      capacity: 10, minCapacity: 4,
    },
  ];

  for (const def of excursionDefs) {
    const excursionType =
      (await prisma.excursionType.findFirst({ where: { propertyId: property.id, code: def.code } })) ??
      (await prisma.excursionType.create({
        data: {
          propertyId: property.id,
          code: def.code,
          name: def.name,
          description: def.description,
          chargeCodeId: excursionChargeCodeByCode[def.chargeCode],
          cutoffHours: def.cutoffHours,
          rates: { create: [{ adultPrice: def.adultPrice, childPrice: def.childPrice, infantPrice: 0, effectiveFrom: new Date("2020-01-01") }] },
        },
      }));

    const schedule =
      (await prisma.excursionSchedule.findFirst({ where: { excursionTypeId: excursionType.id } })) ??
      (await prisma.excursionSchedule.create({
        data: {
          excursionTypeId: excursionType.id,
          daysOfWeek: def.daysOfWeek,
          departureTime: def.departureTime,
          meetingTime: def.meetingTime,
          meetingPoint: def.meetingPoint,
          capacity: def.capacity,
          minCapacity: def.minCapacity,
        },
      }));

    // Same expansion logic the "Generate Departures" Controls action uses (see
    // src/app/api/excursions/schedules/generate/route.ts), applied directly here —
    // idempotent, so re-running this seed never duplicates an already-generated date.
    const today = new Date();
    const through = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
    const dates = expandScheduleDates(schedule.daysOfWeek, today, through);
    for (const date of dates) {
      const exists = await prisma.excursionDeparture.findUnique({
        where: {
          excursionTypeId_departureDate_departureTime: {
            excursionTypeId: excursionType.id,
            departureDate: date,
            departureTime: schedule.departureTime,
          },
        },
      });
      if (!exists) {
        await prisma.excursionDeparture.create({
          data: {
            excursionTypeId: excursionType.id,
            scheduleId: schedule.id,
            departureDate: date,
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

  // 12. Spa Booking add-on (see .agents/docs/SPA_PLAN.md) — Osta-enabled for this
  // property, a catalog across three categories, three therapists with distinct
  // skill sets and working hours, and three rooms (including one couple-capable
  // room) — so the booking flow (guest search -> treatment -> date/time ->
  // auto-assign) has real, varied data to exercise immediately after seeding. No
  // sample SpaAppointment rows are seeded, matching how the Excursions section above
  // only seeds catalog data (types/schedules/departures) and leaves actual bookings
  // to be created by walking through the real booking flow, rather than
  // hand-fabricating FolioLineItem/Payment state for fake historical transactions.
  await prisma.propertyModuleAccess.upsert({
    where: { propertyId_module: { propertyId: property.id, module: "SPA" } },
    update: { enabled: true },
    create: { propertyId: property.id, module: "SPA", enabled: true },
  });

  const spaChargeCodes: Array<{ code: string; description: string }> = [
    { code: "SPA", description: "Spa Massage Revenue" },
    { code: "SPA-FAC", description: "Spa Facial Revenue" },
    { code: "SPA-CPL", description: "Spa Couple Treatment Revenue" },
  ];
  const spaChargeCodeByCode: Record<string, string> = {};
  for (const cc of spaChargeCodes) {
    const created = await prisma.chargeCode.upsert({
      where: { enterpriseId_code: { enterpriseId: veyo.id, code: cc.code } },
      update: {},
      create: { enterpriseId: veyo.id, code: cc.code, description: cc.description, chargeSubgroupId: subgroupId("SPA_TREATMENT") },
    });
    spaChargeCodeByCode[cc.code] = created.id;
  }

  const spaCategoryDefs: Array<{ name: string; description: string }> = [
    { name: "Massage", description: "Relaxing and therapeutic massages" },
    { name: "Facial", description: "Facial treatments and skincare" },
    { name: "Couple Treatments", description: "Treatments for two guests together" },
  ];
  const spaCategoryByName: Record<string, string> = {};
  for (const def of spaCategoryDefs) {
    const category =
      (await prisma.spaTreatmentCategory.findFirst({ where: { propertyId: property.id, name: def.name } })) ??
      (await prisma.spaTreatmentCategory.create({
        data: { propertyId: property.id, name: def.name, description: def.description },
      }));
    spaCategoryByName[def.name] = category.id;
  }

  // Deliberately varied working hours per therapist (not all 09-18) — realistic, and
  // gives the availability engine genuine differences to resolve rather than three
  // identical schedules that would never expose a scheduling edge case.
  const spaTherapistDefs: Array<{ name: string; gender: string; phone: string; startTime: string; endTime: string }> = [
    { name: "Aisha Rahman", gender: "FEMALE", phone: "555-0110", startTime: "08:00", endTime: "20:00" },
    { name: "Fatima Ali", gender: "FEMALE", phone: "555-0111", startTime: "09:00", endTime: "18:00" },
    { name: "Noor Hassan", gender: "MALE", phone: "555-0112", startTime: "10:00", endTime: "19:00" },
  ];
  const spaTherapistByName: Record<string, string> = {};
  for (const def of spaTherapistDefs) {
    const therapist =
      (await prisma.spaTherapist.findFirst({ where: { propertyId: property.id, displayName: def.name } })) ??
      (await prisma.spaTherapist.create({
        data: { propertyId: property.id, displayName: def.name, gender: def.gender, phone: def.phone },
      }));
    spaTherapistByName[def.name] = therapist.id;

    const hasSchedule = await prisma.spaTherapistSchedule.findFirst({ where: { therapistId: therapist.id } });
    if (!hasSchedule) {
      await prisma.spaTherapistSchedule.createMany({
        data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          therapistId: therapist.id,
          dayOfWeek,
          startTime: def.startTime,
          endTime: def.endTime,
          effectiveFrom: new Date("2020-01-01"),
        })),
      });
    }
  }

  const spaRoomDefs: Array<{ name: string; capacity: number }> = [
    { name: "Treatment Room 1", capacity: 1 },
    { name: "Treatment Room 2", capacity: 1 },
    { name: "Couple Treatment Room", capacity: 2 },
  ];
  const spaRoomByName: Record<string, string> = {};
  for (const def of spaRoomDefs) {
    const room =
      (await prisma.spaRoom.findFirst({ where: { propertyId: property.id, name: def.name } })) ??
      (await prisma.spaRoom.create({ data: { propertyId: property.id, name: def.name, capacity: def.capacity } }));
    spaRoomByName[def.name] = room.id;
  }

  // Deliberately uneven qualification (not every therapist does everything) so the
  // booking engine's candidate-narrowing and auto-assignment are actually exercised
  // rather than trivially satisfied by any therapist. The first name in each list is
  // marked `preferred`.
  const spaTreatmentDefs: Array<{
    name: string; category: string; duration: number; prep: number; cleanup: number;
    chargeCode: string; price: number; maxParticipants?: number; pricingMode?: string;
    therapists: string[];
  }> = [
    { name: "Swedish Massage", category: "Massage", duration: 60, prep: 10, cleanup: 15, chargeCode: "SPA", price: 80, therapists: ["Aisha Rahman", "Noor Hassan"] },
    { name: "Deep Tissue Massage", category: "Massage", duration: 60, prep: 10, cleanup: 15, chargeCode: "SPA", price: 90, therapists: ["Aisha Rahman"] },
    { name: "Balinese Massage", category: "Massage", duration: 90, prep: 10, cleanup: 15, chargeCode: "SPA", price: 120, therapists: ["Fatima Ali"] },
    { name: "Foot Massage", category: "Massage", duration: 30, prep: 5, cleanup: 10, chargeCode: "SPA", price: 40, therapists: ["Fatima Ali", "Aisha Rahman"] },
    { name: "Facial Treatment", category: "Facial", duration: 45, prep: 10, cleanup: 15, chargeCode: "SPA-FAC", price: 70, therapists: ["Noor Hassan"] },
    {
      name: "Couple Massage", category: "Couple Treatments", duration: 60, prep: 10, cleanup: 20,
      chargeCode: "SPA-CPL", price: 180, maxParticipants: 2, pricingMode: "FLAT",
      therapists: ["Aisha Rahman", "Fatima Ali"],
    },
  ];

  for (const def of spaTreatmentDefs) {
    const treatment =
      (await prisma.spaTreatment.findFirst({ where: { propertyId: property.id, name: def.name } })) ??
      (await prisma.spaTreatment.create({
        data: {
          propertyId: property.id,
          categoryId: spaCategoryByName[def.category],
          name: def.name,
          defaultDurationMinutes: def.duration,
          preparationBufferMinutes: def.prep,
          cleanupBufferMinutes: def.cleanup,
          chargeCodeId: spaChargeCodeByCode[def.chargeCode],
          maxParticipants: def.maxParticipants ?? 1,
          pricingMode: def.pricingMode ?? "PER_PERSON",
          rates: { create: [{ price: def.price, effectiveFrom: new Date("2020-01-01") }] },
        },
      }));

    for (const therapistName of def.therapists) {
      const therapistId = spaTherapistByName[therapistName];
      const existingSkill = await prisma.spaTherapistTreatment.findUnique({
        where: { therapistId_treatmentId: { therapistId, treatmentId: treatment.id } },
      });
      if (!existingSkill) {
        await prisma.spaTherapistTreatment.create({
          data: { therapistId, treatmentId: treatment.id, qualified: true, preferred: def.therapists[0] === therapistName },
        });
      }
    }
  }

  const spaSettingsExisting = await prisma.spaSettings.findUnique({ where: { propertyId: property.id } });
  if (!spaSettingsExisting) {
    await prisma.spaSettings.create({
      data: { propertyId: property.id, defaultOpeningTime: "09:00", defaultClosingTime: "19:00" },
    });
  }

  console.log("\nVeyo enterprise seeded successfully.");
  console.log(`Login URL slug: /e/${veyo.slug}/login`);
  console.log("Users (password: password123):");
  console.log("  admin@veyo.com (Admin)");
  console.log("  frontdesk@veyo.com (Front Desk)");
  console.log("  housekeeping@veyo.com (Housekeeping)");
  console.log("Excursions add-on: enabled, with Snorkelling Trip / Island Hopping / Night Fishing seeded.");
  console.log("Spa add-on: enabled, with 6 treatments across 3 categories, 3 therapists, and 3 rooms (incl. a couple room) seeded.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
