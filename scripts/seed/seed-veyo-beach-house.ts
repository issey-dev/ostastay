// Clean, self-contained seed for the "Veyo Beach House" demo property.
//
// Run with:
//   npx tsx scripts/seed/seed-veyo-beach-house.ts
//
// What this creates (see .agents/docs/DECISIONS.md for the full rundown):
//   - Veyo enterprise (slug "veyo") + Veyo Beach House property
//   - 4 room types / 15 rooms, with Bed Type / View / Amenity features
//   - 2 outlets (Veyo Garden restaurant, Maaveyo Spa)
//   - A 26-code chart of accounts (1000 Room / 2000 F&B / 3000 Transport /
//     4000 Spa-Recreation / 5000 Tax / 6000 System / 8000 Non-Revenue)
//   - 5 meal-plan components (Breakfast/Lunch/Dinner/Beverage/Transfer) wired
//     into 6 meal plans (Room Only < BB < HB < FB < AI < AI+), allocation
//     calculation mode set to MEAL_PLAN (not rate-plan) per spec
//   - 11 rate plans (locked Base + 10 selectable: standard, non-refundable,
//     derived advance-purchase, long-stay, seasonal, walk-in, two negotiated
//     agent/corporate rates with commission, complimentary, house-use) each
//     with 2 years of daily pricing (2026-01-01 through 2027-12-31) across
//     all 4 room types
//   - All 13 Controls > Dropdowns LOV categories populated
//   - 20 profiles (5 Guest / 5 Company / 5 Travel Agent / 5 Staff)
//   - NO reservations
//
// Idempotent: re-running this script wipes any existing "veyo"-slug
// enterprise (all of it — reservations, folios, payments, everything) and
// rebuilds it from scratch, so it's always safe to run again.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { SYSTEM_ROLE_DEFS, ensureRoles } from "../../prisma/rbac-seed-data";

const prisma = new PrismaClient();

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Date helpers ─────────────────────────────────────────────────────────
// 2 years, 2026-01-01 through 2027-12-31 (365 + 365 = 730 nights, both non-leap).
function twoYearsOfNights(): Date[] {
  const dates: Date[] = [];
  for (let i = 0; i < 730; i++) {
    dates.push(new Date(Date.UTC(2026, 0, 1 + i)));
  }
  return dates;
}
const NIGHTS = twoYearsOfNights();
const isWeekendNight = (d: Date) => {
  const day = d.getUTCDay();
  return day === 5 || day === 6; // Fri/Sat weekend, matches the Maldives-region property timezone
};
const isSummer = (d: Date) => {
  const m = d.getUTCMonth();
  return m === 5 || m === 6 || m === 7; // Jun-Aug, occurs twice across the 2-year span
};

async function insertCalendarChunked(rows: Array<{ ratePlanId: string; roomTypeId: string; date: Date; price: number; extraAdultPrice: number; extraChildPrice: number }>) {
  const CHUNK = 2000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.priceCalendar.createMany({ data: rows.slice(i, i + CHUNK) });
  }
}

async function main() {
  // ── 0. Wipe any existing "veyo" enterprise for a clean rebuild ──────────
  const existingVeyo = await prisma.enterprise.findUnique({ where: { slug: "veyo" } });
  if (existingVeyo) {
    console.log("Existing Veyo enterprise found — wiping for a clean rebuild...");
    const properties = await prisma.property.findMany({ where: { enterpriseId: existingVeyo.id }, select: { id: true } });
    const propertyIds = properties.map((p) => p.id);
    // Payment has no cascade from Folio/CashierShift — must go first.
    await prisma.payment.deleteMany({
      where: {
        OR: [
          { shift: { enterpriseId: existingVeyo.id } },
          ...(propertyIds.length > 0 ? [{ folio: { propertyId: { in: propertyIds } } }] : []),
        ],
      },
    });
    if (propertyIds.length > 0) {
      // Reservation cascades RoomAssignment/Folio/FolioLineItem/AccompanyingGuest/etc.,
      // and itself has no cascade from Property, so it must go first.
      await prisma.reservation.deleteMany({ where: { propertyId: { in: propertyIds } } });
      // Walk-in folios (no reservation) still reference the property directly, and
      // their FolioLineItems reference ChargeCode with no cascade — clear them before
      // ChargeCode gets cascade-deleted via the Enterprise delete below.
      await prisma.folio.deleteMany({ where: { propertyId: { in: propertyIds } } });
      // Room -> RoomType has no cascade; both are sibling children of Property, so
      // Room must be deleted explicitly before the Property cascade reaches RoomType.
      await prisma.room.deleteMany({ where: { propertyId: { in: propertyIds } } });
      // Allocation -> ChargeCode has no cascade; Allocation is property-scoped while
      // ChargeCode is enterprise-scoped, so clear Allocation before the Enterprise
      // delete cascades ChargeCode away.
      await prisma.allocation.deleteMany({ where: { propertyId: { in: propertyIds } } });
      // GroupBlock/CurrencyExchange/PropertyNightAuditLog have no cascade from Property.
      await prisma.groupBlock.deleteMany({ where: { propertyId: { in: propertyIds } } });
      await prisma.currencyExchange.deleteMany({ where: { propertyId: { in: propertyIds } } });
      await prisma.propertyNightAuditLog.deleteMany({ where: { propertyId: { in: propertyIds } } });
    }
    // CashierShift has no cascade from Enterprise.
    await prisma.cashierShift.deleteMany({ where: { enterpriseId: existingVeyo.id } });
    await prisma.enterprise.delete({ where: { id: existingVeyo.id } });
    console.log("Old Veyo enterprise wiped.\n");
  }

  const passwordHash = await bcrypt.hash("password123", 10);

  // ── 1. Osta INTERNAL enterprise + shared system roles (untouched if present) ─
  const osta = await prisma.enterprise.upsert({
    where: { slug: "osta" },
    update: {},
    create: { name: "Osta", slug: "osta", type: "INTERNAL" },
  });
  const systemRoleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

  // ── 2. Veyo enterprise + license + blank settings (filled in later) ─────
  const veyo = await prisma.enterprise.create({ data: { name: "Veyo", slug: "veyo", type: "STANDARD" } });
  await prisma.enterpriseLicense.create({ data: { enterpriseId: veyo.id, tier: "MAX", maxProperties: 5 } });
  await prisma.enterpriseSettings.create({ data: { enterpriseId: veyo.id } });

  // ── 3. Users ──────────────────────────────────────────────────────────
  const admin = await prisma.user.create({
    data: { enterpriseId: veyo.id, email: "admin@veyo.com", passwordHash, firstName: "Veyo", lastName: "Admin", roleId: systemRoleIds["Admin"], scope: "ENTERPRISE" },
  });
  await prisma.user.create({
    data: { enterpriseId: veyo.id, email: "frontdesk@veyo.com", passwordHash, firstName: "Fatima", lastName: "Desk", roleId: systemRoleIds["Front Desk"], scope: "ENTERPRISE" },
  });
  await prisma.user.create({
    data: { enterpriseId: veyo.id, email: "housekeeping@veyo.com", passwordHash, firstName: "Aisha", lastName: "Maid", roleId: systemRoleIds["Housekeeping"], scope: "ENTERPRISE" },
  });

  // ── 4. Property ───────────────────────────────────────────────────────
  const property = await prisma.property.create({
    data: {
      enterpriseId: veyo.id,
      name: "Veyo Beach House",
      legalName: "Veyo Beach House Pvt Ltd",
      code: "VBH-MAIN",
      defaultCurrency: "USD",
      timeZone: "Indian/Maldives",
      checkInTime: "14:00",
      checkOutTime: "12:00",
      contactEmail: "frontdesk@veyo.com",
      contactPhone: "+960 555 0100",
      pricesIncludeTaxes: true,
      // Per spec: allocations tied to meal plans depend on the MEAL PLAN
      // selected, not the rate plan — MealPlanAllocation links drive pricing,
      // RatePlanAllocation links are deliberately left empty.
      allocationCalculationMode: "MEAL_PLAN",
    },
  });

  const building = await prisma.building.create({ data: { propertyId: property.id, name: "Main Building" } });
  const groundFloor = await prisma.floor.create({ data: { buildingId: building.id, name: "Ground Floor" } });
  const firstFloor = await prisma.floor.create({ data: { buildingId: building.id, name: "First Floor" } });

  await prisma.facility.createMany({
    data: [
      { propertyId: property.id, name: "Infinity Pool", description: "Adults-only infinity pool overlooking the lagoon" },
      { propertyId: property.id, name: "Fitness Center", description: "24-hour gym with ocean views" },
      { propertyId: property.id, name: "Kids Club", description: "Supervised activities for ages 4-12" },
    ],
  });

  // ── 5. System Codes (all 13 Controls > Dropdowns categories) ────────────
  const systemCodes = [
    { category: "GENDER", code: "M", value: "Male", sortOrder: 1 },
    { category: "GENDER", code: "F", value: "Female", sortOrder: 2 },
    { category: "TITLE", code: "MR", value: "Mr", sortOrder: 1 },
    { category: "TITLE", code: "MRS", value: "Mrs", sortOrder: 2 },
    { category: "TITLE", code: "MS", value: "Ms", sortOrder: 3 },
    { category: "TITLE", code: "DR", value: "Dr", sortOrder: 4 },
    { category: "NATIONALITY", code: "MV", value: "Maldivian", sortOrder: 1 },
    { category: "NATIONALITY", code: "US", value: "American", sortOrder: 2 },
    { category: "NATIONALITY", code: "GB", value: "British", sortOrder: 3 },
    { category: "NATIONALITY", code: "AU", value: "Australian", sortOrder: 4 },
    { category: "NATIONALITY", code: "IN", value: "Indian", sortOrder: 5 },
    { category: "NATIONALITY", code: "AE", value: "Emirati", sortOrder: 6 },
    { category: "NATIONALITY", code: "DE", value: "German", sortOrder: 7 },
    { category: "ID_TYPE", code: "PASSPORT", value: "Passport", sortOrder: 1 },
    { category: "ID_TYPE", code: "NATIONAL_ID", value: "National ID", sortOrder: 2 },
    { category: "ID_TYPE", code: "DRIVERS_LICENSE", value: "Driver's License", sortOrder: 3 },
    { category: "CLASSIFICATION", code: "VIP", value: "VIP", sortOrder: 1 },
    { category: "CLASSIFICATION", code: "REGULAR", value: "Regular", sortOrder: 2 },
    { category: "CLASSIFICATION", code: "BLACKLISTED", value: "Blacklisted", sortOrder: 3 },
    { category: "VIP_LEVEL", code: "SILVER", value: "Silver", sortOrder: 1 },
    { category: "VIP_LEVEL", code: "GOLD", value: "Gold", sortOrder: 2 },
    { category: "VIP_LEVEL", code: "PLATINUM", value: "Platinum", sortOrder: 3 },
    { category: "DIETARY_REQ", code: "VEGAN", value: "Vegan", sortOrder: 1 },
    { category: "DIETARY_REQ", code: "VEGETARIAN", value: "Vegetarian", sortOrder: 2 },
    { category: "DIETARY_REQ", code: "GLUTEN_FREE", value: "Gluten-Free", sortOrder: 3 },
    { category: "DIETARY_REQ", code: "HALAL", value: "Halal", sortOrder: 4 },
    { category: "DIETARY_REQ", code: "KOSHER", value: "Kosher", sortOrder: 5 },
    { category: "PREFERENCE", code: "HIGH_FLOOR", value: "High Floor", sortOrder: 1 },
    { category: "PREFERENCE", code: "QUIET_ROOM", value: "Quiet Room", sortOrder: 2 },
    { category: "PREFERENCE", code: "EXTRA_PILLOWS", value: "Extra Pillows", sortOrder: 3 },
    { category: "PREFERENCE", code: "NON_SMOKING", value: "Non-Smoking", sortOrder: 4 },
    { category: "PREFERENCE", code: "OCEAN_VIEW_REQUEST", value: "Ocean View Request", sortOrder: 5 },
    { category: "HOUSEKEEPING_REQUEST", code: "EXTRA_TOWELS", value: "Extra Towels", sortOrder: 1 },
    { category: "HOUSEKEEPING_REQUEST", code: "EXTRA_PILLOWS", value: "Extra Pillows", sortOrder: 2 },
    { category: "HOUSEKEEPING_REQUEST", code: "MINIBAR_RESTOCK", value: "Minibar Restock", sortOrder: 3 },
    { category: "HOUSEKEEPING_REQUEST", code: "TURNDOWN_SERVICE", value: "Turndown Service", sortOrder: 4 },
    { category: "HOUSEKEEPING_REQUEST", code: "ROOM_CLEANING_NOW", value: "Room Cleaning (Now)", sortOrder: 5 },
    { category: "SPECIAL_REQUEST", code: "HIGH_FLOOR", value: "High Floor", sortOrder: 1 },
    { category: "SPECIAL_REQUEST", code: "EARLY_CHECKIN", value: "Early Check-in", sortOrder: 2 },
    { category: "SPECIAL_REQUEST", code: "LATE_CHECKOUT", value: "Late Checkout", sortOrder: 3 },
    { category: "SPECIAL_REQUEST", code: "AIRPORT_PICKUP", value: "Airport Pickup", sortOrder: 4 },
    { category: "SPECIAL_REQUEST", code: "BABY_COT", value: "Baby Cot", sortOrder: 5 },
    { category: "SPECIAL_REQUEST", code: "HONEYMOON_SETUP", value: "Honeymoon Setup", sortOrder: 6 },
    { category: "BED_TYPE", code: "KING", value: "King Bed", sortOrder: 1 },
    { category: "BED_TYPE", code: "QUEEN", value: "Queen Bed", sortOrder: 2 },
    { category: "BED_TYPE", code: "TWIN", value: "Twin Beds", sortOrder: 3 },
    { category: "ROOM_VIEW", code: "OCEAN", value: "Ocean View", sortOrder: 1 },
    { category: "ROOM_VIEW", code: "GARDEN", value: "Garden View", sortOrder: 2 },
    { category: "ROOM_VIEW", code: "LAGOON", value: "Lagoon View", sortOrder: 3 },
    { category: "ROOM_AMENITY", code: "BALCONY", value: "Private Balcony", sortOrder: 1 },
    { category: "ROOM_AMENITY", code: "PRIVATE_POOL", value: "Private Pool", sortOrder: 2 },
    { category: "ROOM_AMENITY", code: "JACUZZI", value: "Jacuzzi", sortOrder: 3 },
    { category: "ROOM_AMENITY", code: "BUTLER", value: "Butler Service", sortOrder: 4 },
    { category: "ROOM_AMENITY", code: "MINIBAR", value: "Minibar", sortOrder: 5 },
  ];
  await prisma.systemCode.createMany({ data: systemCodes.map((sc) => ({ enterpriseId: veyo.id, ...sc })) });

  // ── 6. Room types + features ────────────────────────────────────────────
  const roomTypeDefs = [
    { code: "GDN", name: "Garden View Room", baseOccupancy: 2, maxOccupancy: 2, features: { BED_TYPE: "QUEEN", ROOM_VIEW: "GARDEN", ROOM_AMENITY: ["MINIBAR"] } },
    { code: "DLX", name: "Deluxe Beach Villa", baseOccupancy: 2, maxOccupancy: 3, features: { BED_TYPE: "KING", ROOM_VIEW: "OCEAN", ROOM_AMENITY: ["BALCONY", "MINIBAR"] } },
    { code: "STE", name: "Overwater Suite", baseOccupancy: 2, maxOccupancy: 4, features: { BED_TYPE: "KING", ROOM_VIEW: "LAGOON", ROOM_AMENITY: ["BALCONY", "JACUZZI", "MINIBAR"] } },
    { code: "PRES", name: "Presidential Water Villa", baseOccupancy: 2, maxOccupancy: 5, features: { BED_TYPE: "KING", ROOM_VIEW: "LAGOON", ROOM_AMENITY: ["PRIVATE_POOL", "JACUZZI", "BUTLER", "BALCONY", "MINIBAR"] } },
  ] as const;

  const roomTypeByCode: Record<string, { id: string }> = {};
  for (const rt of roomTypeDefs) {
    const created = await prisma.roomType.create({
      data: { propertyId: property.id, code: rt.code, name: rt.name, baseOccupancy: rt.baseOccupancy, maxOccupancy: rt.maxOccupancy },
    });
    roomTypeByCode[rt.code] = created;
    await prisma.roomTypeFeature.create({ data: { roomTypeId: created.id, category: "BED_TYPE", code: rt.features.BED_TYPE } });
    await prisma.roomTypeFeature.create({ data: { roomTypeId: created.id, category: "ROOM_VIEW", code: rt.features.ROOM_VIEW } });
    for (const amenity of rt.features.ROOM_AMENITY) {
      await prisma.roomTypeFeature.create({ data: { roomTypeId: created.id, category: "ROOM_AMENITY", code: amenity } });
    }
  }

  // ── 7. Rooms (15 total) ──────────────────────────────────────────────────
  const roomDefs: Array<{ roomTypeCode: string; roomNumber: string; floorId: string }> = [
    { roomTypeCode: "GDN", roomNumber: "101", floorId: groundFloor.id },
    { roomTypeCode: "GDN", roomNumber: "102", floorId: groundFloor.id },
    { roomTypeCode: "GDN", roomNumber: "103", floorId: groundFloor.id },
    { roomTypeCode: "GDN", roomNumber: "104", floorId: groundFloor.id },
    { roomTypeCode: "GDN", roomNumber: "105", floorId: groundFloor.id },
    { roomTypeCode: "DLX", roomNumber: "106", floorId: groundFloor.id },
    { roomTypeCode: "DLX", roomNumber: "107", floorId: groundFloor.id },
    { roomTypeCode: "DLX", roomNumber: "108", floorId: groundFloor.id },
    { roomTypeCode: "DLX", roomNumber: "201", floorId: firstFloor.id },
    { roomTypeCode: "DLX", roomNumber: "202", floorId: firstFloor.id },
    { roomTypeCode: "STE", roomNumber: "301", floorId: firstFloor.id },
    { roomTypeCode: "STE", roomNumber: "302", floorId: firstFloor.id },
    { roomTypeCode: "STE", roomNumber: "303", floorId: firstFloor.id },
    { roomTypeCode: "PRES", roomNumber: "401", floorId: firstFloor.id },
    { roomTypeCode: "PRES", roomNumber: "402", floorId: firstFloor.id },
  ];
  await prisma.room.createMany({
    data: roomDefs.map((r) => ({
      propertyId: property.id,
      roomTypeId: roomTypeByCode[r.roomTypeCode].id,
      roomNumber: r.roomNumber,
      floorId: r.floorId,
      status: "CLEAN",
    })),
  });

  // ── 8. Tax profile (a custom override, used only by the Spa charge code —
  // everything else uses the enterprise default engine: Service Charge/GST/
  // Green Tax) ──────────────────────────────────────────────────────────────
  const spaTaxProfile = await prisma.taxProfile.create({
    data: {
      enterpriseId: veyo.id,
      name: "Spa Service Tax",
      rates: { create: [{ name: "Spa Service Tax", ratePercent: 8, calculateOn: "BASE", order: 0, effectiveFrom: new Date("2020-01-01") }] },
    },
  });

  // ── 9. Charge codes — a clean 1000/2000/3000/4000/5000/6000/8000 chart ──
  const chargeCodeDefs: Array<{ code: string; description: string; category: string; taxProfileId?: string }> = [
    // 1000s — Room / Accommodation
    { code: "1000", description: "Room Charge", category: "ROOM" },
    { code: "1010", description: "Extra Bed Charge", category: "ROOM" },
    { code: "1020", description: "Extra Person Charge", category: "ROOM" },
    { code: "1030", description: "Late Check-out Fee", category: "ROOM" },
    { code: "1040", description: "Early Check-in Fee", category: "ROOM" },
    { code: "1090", description: "Cancellation Fee", category: "ROOM" },
    { code: "1091", description: "No-Show Fee", category: "ROOM" },
    // 2000s — Food & Beverage
    { code: "2000", description: "Breakfast", category: "FOOD_BEVERAGE" },
    { code: "2010", description: "Lunch", category: "FOOD_BEVERAGE" },
    { code: "2020", description: "Dinner", category: "FOOD_BEVERAGE" },
    { code: "2030", description: "Beverage Package", category: "FOOD_BEVERAGE" },
    { code: "2040", description: "Restaurant A-la-carte", category: "FOOD_BEVERAGE" },
    { code: "2050", description: "Room Service", category: "FOOD_BEVERAGE" },
    { code: "2090", description: "Mini Bar", category: "FOOD_BEVERAGE" },
    // 3000s — Transportation
    { code: "3000", description: "Speedboat Transfer", category: "TRANSPORTATION" },
    { code: "3010", description: "Seaplane Transfer", category: "TRANSPORTATION" },
    { code: "3020", description: "Airport Shuttle (Domestic)", category: "TRANSPORTATION" },
    { code: "3090", description: "Local Excursion Transport", category: "TRANSPORTATION" },
    // 4000s — Spa / Recreation / Retail (no dedicated SPA category, grouped under OTHERS)
    { code: "4000", description: "Spa Treatment", category: "OTHERS", taxProfileId: spaTaxProfile.id },
    { code: "4010", description: "Massage Therapy", category: "OTHERS" },
    { code: "4020", description: "Water Sports / Excursion", category: "OTHERS" },
    { code: "4030", description: "Gift Shop / Retail", category: "OTHERS" },
    // 5000s — Tax (GTX required literally by this code for Night Audit's Green Tax posting)
    { code: "5000", description: "Green Tax (GTX)", category: "TAX" },
    // 6000s — System / Miscellaneous
    { code: "6000", description: "Miscellaneous Adjustment", category: "SYSTEM" },
    // 8000s — Non-Revenue
    { code: "8000", description: "Travel Agent Commission", category: "NON_REVENUE" },
    { code: "8010", description: "Complimentary / House-Use Room", category: "NON_REVENUE" },
  ];
  const chargeCodeByCode: Record<string, { id: string }> = {};
  for (const cc of chargeCodeDefs) {
    const created = await prisma.chargeCode.create({
      data: {
        enterpriseId: veyo.id,
        code: cc.code,
        description: cc.description,
        category: cc.category,
        ...(cc.taxProfileId ? { useDefaultTax: false, taxProfileId: cc.taxProfileId } : {}),
      },
    });
    chargeCodeByCode[cc.code] = created;
  }
  // Rename the literal "GTX" lookup key used by Night Audit's Green Tax posting —
  // the code STRING itself must be "GTX", not "5000" (see seed-veyo.ts precedent).
  await prisma.chargeCode.update({ where: { id: chargeCodeByCode["5000"].id }, data: { code: "GTX" } });

  // ── 10. Payment methods ─────────────────────────────────────────────────
  const pmCash = await prisma.paymentMethod.create({ data: { enterpriseId: veyo.id, name: "Cash", type: "CASH" } });
  const pmCard = await prisma.paymentMethod.create({ data: { enterpriseId: veyo.id, name: "Credit Card", type: "CARD" } });
  await prisma.paymentMethod.create({ data: { enterpriseId: veyo.id, name: "Bank Transfer", type: "TRANSFER" } });
  const pmCityLedger = await prisma.paymentMethod.create({ data: { enterpriseId: veyo.id, name: "City Ledger", type: "CITY_LEDGER" } });
  void pmCash;
  void pmCard;

  // ── 11. Enterprise Settings — posting/settlement defaults + invoice branding ─
  await prisma.enterpriseSettings.update({
    where: { enterpriseId: veyo.id },
    data: {
      resConfirmPrefix: "VBH-",
      resConfirmLength: 6,
      defaultAccommodationChargeCodeId: chargeCodeByCode["1000"].id,
      cityLedgerPaymentMethodId: pmCityLedger.id,
      commissionChargeCodeId: chargeCodeByCode["8000"].id,
      invoiceBrandName: "Veyo Beach House",
      invoiceBrandColor: "#0d6e6e",
      invoicePhone: "+960 555 0100",
      invoiceEmail: "frontdesk@veyo.com",
      invoiceAddress: "Veyo Beach House, North Male Atoll, Maldives",
      invoicePaymentTerms: "Payment due within 30 days of invoice date.",
      invoiceFooterText: "Thank you for staying with Veyo Beach House.",
    },
  });

  // ── 12. Outlets ──────────────────────────────────────────────────────────
  const gardenOutlet = await prisma.outlet.create({
    data: { propertyId: property.id, name: "Veyo Garden", description: "All-day dining restaurant", outletType: "RESTAURANT" },
  });
  const spaOutlet = await prisma.outlet.create({
    data: { propertyId: property.id, name: "Maaveyo Spa", description: "Spa & wellness center", outletType: "SPA" },
  });
  for (const code of ["2000", "2010", "2020", "2030", "2040", "2050", "2090"]) {
    await prisma.outletChargeCode.create({ data: { outletId: gardenOutlet.id, chargeCodeId: chargeCodeByCode[code].id } });
  }
  for (const code of ["4000", "4010", "4020", "4030"]) {
    await prisma.outletChargeCode.create({ data: { outletId: spaOutlet.id, chargeCodeId: chargeCodeByCode[code].id } });
  }

  // ── 13. Allocations (meal-plan components) ──────────────────────────────
  const effFrom = new Date("2026-01-01");
  const bf = await prisma.allocation.create({
    data: { propertyId: property.id, code: "BF", name: "Breakfast", type: "FNB", chargeCodeId: chargeCodeByCode["2000"].id, postingRhythm: "EVERY_NIGHT", mode: "INCLUDE_IN_RATE", sellSeparate: false, rates: { create: { adultPrice: 12, childPrice: 6, effectiveFrom: effFrom } } },
  });
  const ln = await prisma.allocation.create({
    data: { propertyId: property.id, code: "LN", name: "Lunch", type: "FNB", chargeCodeId: chargeCodeByCode["2010"].id, postingRhythm: "EVERY_NIGHT", mode: "ADD_TO_RATE", sellSeparate: true, rates: { create: { adultPrice: 22, childPrice: 11, effectiveFrom: effFrom } } },
  });
  const dn = await prisma.allocation.create({
    data: { propertyId: property.id, code: "DN", name: "Dinner", type: "FNB", chargeCodeId: chargeCodeByCode["2020"].id, postingRhythm: "EVERY_NIGHT", mode: "ADD_TO_RATE", sellSeparate: false, rates: { create: { adultPrice: 35, childPrice: 17, effectiveFrom: effFrom } } },
  });
  const bev = await prisma.allocation.create({
    data: { propertyId: property.id, code: "BEV", name: "Beverage Package", type: "FNB", chargeCodeId: chargeCodeByCode["2030"].id, postingRhythm: "EVERY_NIGHT", mode: "ADD_TO_RATE", sellSeparate: false, rates: { create: { adultPrice: 25, childPrice: 10, effectiveFrom: effFrom } } },
  });
  const trf = await prisma.allocation.create({
    data: { propertyId: property.id, code: "TRF", name: "Speedboat Transfer", type: "TRANSFER", chargeCodeId: chargeCodeByCode["3000"].id, postingRhythm: "ARRIVAL_NIGHT", mode: "ADD_TO_RATE", sellSeparate: true, rates: { create: { adultPrice: 45, childPrice: 22, effectiveFrom: effFrom } } },
  });

  // ── 14. Meal plans — strict inclusion hierarchy Room < BB < HB < FB < AI < AI+ ─
  const mealPlanDefs: Array<{ code: string; name: string; allocationIds: string[] }> = [
    { code: "RO", name: "Room Only", allocationIds: [] },
    { code: "BB", name: "Bed & Breakfast", allocationIds: [bf.id] },
    { code: "HB", name: "Half Board", allocationIds: [bf.id, dn.id] },
    { code: "FB", name: "Full Board", allocationIds: [bf.id, ln.id, dn.id] },
    { code: "AI", name: "All-Inclusive", allocationIds: [bf.id, ln.id, dn.id, bev.id] },
    { code: "AIP", name: "All-Inclusive Plus", allocationIds: [bf.id, ln.id, dn.id, bev.id, trf.id] },
  ];
  for (const mp of mealPlanDefs) {
    const created = await prisma.mealPlan.create({ data: { propertyId: property.id, code: mp.code, name: mp.name } });
    for (const allocationId of mp.allocationIds) {
      await prisma.mealPlanAllocation.create({ data: { mealPlanId: created.id, allocationId } });
    }
  }

  // ── 15. Rate plans — locked Base + 10 selectable, a genuine mix of every
  // RatePlan feature (locked/derived/negotiated/complimentary/house-use) ───
  const roomChargeCodeId = chargeCodeByCode["1000"].id;
  const nonRevChargeCodeId = chargeCodeByCode["8010"].id;

  const baseRate = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "BASE", name: "Base Rate", priority: 999, isLocked: true, chargeCodeId: roomChargeCodeId } });
  const bar = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "BAR", name: "Best Available Rate", description: "Standard flexible rate", chargeCodeId: roomChargeCodeId } });
  const nrf = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "NRF", name: "Non-Refundable", description: "Discounted, prepaid, non-refundable rate", chargeCodeId: roomChargeCodeId } });
  const adv30 = await prisma.ratePlan.create({
    data: {
      propertyId: property.id, code: "ADV30", name: "Advance Purchase 30", description: "Book 30 days ahead, 15% off BAR — derived live from BAR's own calendar",
      chargeCodeId: roomChargeCodeId, parentRatePlanId: bar.id, derivedAdjustmentType: "PERCENT", derivedAdjustmentValue: -15,
    },
  });
  const los7 = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "LOS7", name: "Long Stay 7+ Nights", description: "Flat discount for stays of 7 nights or more", chargeCodeId: roomChargeCodeId } });
  const summer26 = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "SUMMER26", name: "Summer Promo 2026", description: "Seasonal (Jun-Aug) + weekend pricing", chargeCodeId: roomChargeCodeId } });
  const walkin = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "WALKIN", name: "Walk-In Rate", description: "Premium rate for same-day walk-in bookings", chargeCodeId: roomChargeCodeId } });
  const taGlobal = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "TA-GLOBAL", name: "Global Travels Negotiated Rate", description: "Negotiated rate for Global Travels Ltd", isNegotiated: true, chargeCodeId: roomChargeCodeId } });
  const corp = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "CORP", name: "Corporate Rate", description: "Negotiated rate for Atlas Ventures Pte Ltd", isNegotiated: true, chargeCodeId: roomChargeCodeId } });
  const comp = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "COMP", name: "Complimentary", description: "No-charge stay (VIP hosting, inspections)", isComplimentary: true, chargeCodeId: nonRevChargeCodeId } });
  const houseUse = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "HU", name: "House Use", description: "Staff/management occupancy, not guest revenue", isHouseUse: true, chargeCodeId: nonRevChargeCodeId } });

  // ── 16. Price calendars — 2 years x 4 room types x 10 rate plans (ADV30 is
  // derived and resolves live from BAR's calendar — it needs none of its own) ─
  const ROOM_BASE: Record<string, number> = { GDN: 150, DLX: 220, STE: 350, PRES: 550 };
  const ROOM_EXTRA: Record<string, { adult: number; child: number }> = {
    GDN: { adult: 25, child: 12 },
    DLX: { adult: 35, child: 18 },
    STE: { adult: 45, child: 22 },
    PRES: { adult: 60, child: 30 },
  };
  type PriceFn = (base: number, date: Date) => number;
  const pricingRules: Array<{ ratePlanId: string; extra: boolean; fn: PriceFn }> = [
    { ratePlanId: baseRate.id, extra: true, fn: (base) => round2(base * 0.70) },
    { ratePlanId: bar.id, extra: true, fn: (base, date) => round2(base * (isWeekendNight(date) ? 1.12 : 1.0)) },
    { ratePlanId: nrf.id, extra: true, fn: (base) => round2(base * 0.88) },
    { ratePlanId: los7.id, extra: true, fn: (base) => round2(base * 0.80) },
    {
      ratePlanId: summer26.id, extra: true,
      fn: (base, date) => round2(base * (isSummer(date) ? 1.25 : 1.0) * (isWeekendNight(date) ? 1.10 : 1.0)),
    },
    { ratePlanId: walkin.id, extra: true, fn: (base, date) => round2(base * (isWeekendNight(date) ? 1.45 : 1.30)) },
    { ratePlanId: taGlobal.id, extra: true, fn: (base, date) => round2(base * (isWeekendNight(date) ? 0.95 : 0.90)) },
    { ratePlanId: corp.id, extra: true, fn: (base) => round2(base * 0.95) },
    { ratePlanId: comp.id, extra: false, fn: () => 0 },
    { ratePlanId: houseUse.id, extra: false, fn: () => 0 },
  ];

  for (const [rtCode, roomTypeRow] of Object.entries(roomTypeByCode)) {
    const base = ROOM_BASE[rtCode];
    const extra = ROOM_EXTRA[rtCode];
    for (const rule of pricingRules) {
      const rows = NIGHTS.map((date) => ({
        ratePlanId: rule.ratePlanId,
        roomTypeId: roomTypeRow.id,
        date,
        price: rule.fn(base, date),
        extraAdultPrice: rule.extra ? extra.adult : 0,
        extraChildPrice: rule.extra ? extra.child : 0,
      }));
      await insertCalendarChunked(rows);
    }
  }
  console.log(`Price calendars seeded: 10 rate plans x ${Object.keys(roomTypeByCode).length} room types x ${NIGHTS.length} nights.`);

  // ── 17. Profiles — 5 Guest / 5 Company / 5 Travel Agent / 5 Staff ────────
  const mkCommunication = (email: string) => ({ create: [{ type: "EMAIL", value: email, isPrimary: true }] });
  const mkAddress = (country: string, city: string) => ({ create: [{ type: "HOME", fullAddress: "", city, country, isPrimary: true }] });

  const guestDefs = [
    { firstName: "Sarah", lastName: "Mitchell", title: "MRS", gender: "F", country: "US", city: "Austin", vipLevel: "GOLD", dietary: "VEGETARIAN", preference: "HIGH_FLOOR" },
    { firstName: "James", lastName: "Anderson", title: "MR", gender: "M", country: "GB", city: "London" },
    { firstName: "Priya", lastName: "Sharma", title: "MS", gender: "F", country: "IN", city: "Mumbai", vipLevel: "SILVER" },
    { firstName: "Ahmed", lastName: "Al-Farsi", title: "MR", gender: "M", country: "AE", city: "Dubai" },
    { firstName: "Lucas", lastName: "Muller", title: "MR", gender: "M", country: "DE", city: "Berlin", vipLevel: "PLATINUM", dietary: "GLUTEN_FREE" },
  ];
  const guestProfiles = [];
  for (const g of guestDefs) {
    const p = await prisma.profile.create({
      data: {
        enterpriseId: veyo.id, profileType: "GUEST", title: g.title, firstName: g.firstName, lastName: g.lastName,
        gender: g.gender, nationality: g.country, vipLevel: g.vipLevel ?? null, originPropertyId: property.id,
        communications: mkCommunication(`${g.firstName.toLowerCase()}.${g.lastName.toLowerCase().replace(/[^a-z]/g, "")}@example.com`),
        addresses: mkAddress(g.country, g.city),
      },
    });
    if (g.dietary) await prisma.profilePreference.create({ data: { upid: p.upid, category: "DIETARY", value: g.dietary } });
    if (g.preference) await prisma.profilePreference.create({ data: { upid: p.upid, category: "PREFERENCE", value: g.preference } });
    if (g.vipLevel === "PLATINUM") {
      await prisma.profileNote.create({ data: { upid: p.upid, authorUserId: admin.id, noteText: "Repeat guest — always requests late checkout and a quiet room.", isPinned: true } });
      await prisma.profileAttachment.create({ data: { upid: p.upid, label: "Signed registration card", url: "https://example.com/docs/registration-card.pdf" } });
    }
    guestProfiles.push(p);
  }

  const companyDefs = [
    { name: "Atlas Ventures Pte Ltd", country: "US", city: "New York", creditAccount: true, arNumber: "AR-0001", creditLimit: 20000 },
    { name: "Coral Reef Exports Inc", country: "GB", city: "London" },
    { name: "Horizon Tech Solutions", country: "AU", city: "Sydney" },
    { name: "Bluewave Logistics", country: "AE", city: "Dubai" },
    { name: "Meridian Capital Group", country: "US", city: "Chicago" },
  ];
  const companyProfiles = [];
  for (const c of companyDefs) {
    const p = await prisma.profile.create({
      data: {
        enterpriseId: veyo.id, profileType: "COMPANY", firstName: "", companyName: c.name, nationality: c.country, originPropertyId: property.id,
        isCreditAccount: !!c.creditAccount, arNumber: c.arNumber ?? null, creditLimit: c.creditLimit ?? null,
        communications: mkCommunication(`accounts@${c.name.toLowerCase().replace(/[^a-z]/g, "").slice(0, 20)}.example.com`),
        addresses: mkAddress(c.country, c.city),
      },
    });
    companyProfiles.push(p);
  }

  const agentDefs = [
    { name: "Global Travels Ltd", country: "GB", city: "London", creditAccount: true, arNumber: "AR-0002", creditLimit: 50000, iata: "12-34567-8", commissionRate: 10 },
    { name: "Blue Horizon Tours", country: "US", city: "Miami" },
    { name: "Paradise Escapes Agency", country: "AU", city: "Perth" },
    { name: "Oceanic Travel Partners", country: "DE", city: "Munich" },
    { name: "Sunset Getaways Co", country: "IN", city: "Delhi" },
  ];
  const agentProfiles = [];
  for (const a of agentDefs) {
    const p = await prisma.profile.create({
      data: {
        enterpriseId: veyo.id, profileType: "TRAVEL_AGENT", firstName: "", companyName: a.name, nationality: a.country, originPropertyId: property.id,
        isCreditAccount: !!a.creditAccount, arNumber: a.arNumber ?? null, creditLimit: a.creditLimit ?? null,
        iataNumber: a.iata ?? null, commissionRate: a.commissionRate ?? null,
        communications: mkCommunication(`bookings@${a.name.toLowerCase().replace(/[^a-z]/g, "").slice(0, 20)}.example.com`),
        addresses: mkAddress(a.country, a.city),
      },
    });
    agentProfiles.push(p);
  }

  const staffDefs = [
    { firstName: "Aisha", lastName: "Naeem", gender: "F" },
    { firstName: "Hassan", lastName: "Rasheed", gender: "M" },
    { firstName: "Fatima", lastName: "Ibrahim", gender: "F" },
    { firstName: "Ali", lastName: "Waheed", gender: "M" },
    { firstName: "Mariyam", lastName: "Shifa", gender: "F" },
  ];
  for (const s of staffDefs) {
    await prisma.profile.create({
      data: {
        enterpriseId: veyo.id, profileType: "STAFF", firstName: s.firstName, lastName: s.lastName, gender: s.gender, nationality: "MV", originPropertyId: property.id,
        communications: mkCommunication(`${s.firstName.toLowerCase()}.${s.lastName.toLowerCase()}@veyo.example.com`),
      },
    });
  }

  // ── 18. Negotiated-rate access — restrict TA-GLOBAL/CORP to their profile ─
  await prisma.ratePlanAgentAccess.create({ data: { ratePlanId: taGlobal.id, upid: agentProfiles[0].upid, commissionRate: 10 } });
  await prisma.ratePlanAgentAccess.create({ data: { ratePlanId: corp.id, upid: companyProfiles[0].upid, commissionRate: 5 } });

  console.log("\nVeyo Beach House seeded successfully.");
  console.log(`Login URL slug: /e/${veyo.slug}/login`);
  console.log("Users (password: password123):");
  console.log("  admin@veyo.com (Admin)");
  console.log("  frontdesk@veyo.com (Front Desk)");
  console.log("  housekeeping@veyo.com (Housekeeping)");
  console.log(`Room types: ${Object.keys(roomTypeByCode).length}, Rooms: ${roomDefs.length}, Outlets: 2`);
  console.log(`Charge codes: ${chargeCodeDefs.length}, Meal plans: ${mealPlanDefs.length}, Rate plans: 11 (Base + 10 selectable)`);
  console.log(`Profiles: ${guestProfiles.length} Guest, ${companyProfiles.length} Company, ${agentProfiles.length} Travel Agent, ${staffDefs.length} Staff`);
  console.log("Reservations: none (clean baseline).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
