import { PrismaClient, Prisma } from "@prisma/client"
import { ensureChargeTree, ensureFeeRules } from "../../src/lib/posting/ensure-charge-tree"
import { provisionOutletSubgroup } from "../../src/lib/posting/outlet-subgroup"
import { TAX_CODES } from "../../src/lib/posting/charge-tree"

// The demo dataset: a SECOND property under Veyo, and a full spread of reservations
// across both so every module has something real to show.
//
// Split out of seed-veyo.ts, which already runs to ~900 lines setting up the enterprise,
// users, chart of accounts, allocations, excursions and spa. Bolting another 500 lines
// onto it would make the whole thing unreviewable; this file is called at the end of it
// and owns one coherent job.
//
// EVERYTHING IS ANCHORED ON THE BUSINESS DATE, not wall clock. A demo whose "arrivals
// today" quietly become "arrivals last Tuesday" a week later is worse than no demo, so
// both properties' Property.businessDate is pinned and every reservation is positioned
// relative to it.

const DAY = 86_400_000

export const BUSINESS_DATE = new Date(Date.UTC(2026, 7, 1)) // 01 Aug 2026, UTC midnight

/** N days from the business date, at UTC midnight. */
export const bizPlus = (n: number) => new Date(BUSINESS_DATE.getTime() + n * DAY)

type Tx = PrismaClient | Prisma.TransactionClient

let confSeq = 4200
const conf = (prefix: string) => `${prefix}${confSeq++}`

// ── Property 2 ────────────────────────────────────────────────────────────────────
//
// Deliberately NOT a copy of the resort: its own room types, its own room numbering and
// its own outlets, because that is what actually exercises per-property scoping. What it
// does share is everything that is enterprise-level by design — the chart of accounts,
// tax profiles, payment methods and guest profiles — since duplicating those would
// misrepresent how the app works.
const LAGOON_ROOM_TYPES = [
  { code: "GDN", name: "Garden Bungalow", baseOccupancy: 2, maxOccupancy: 3, price: 180 },
  { code: "LPV", name: "Lagoon Pool Villa", baseOccupancy: 2, maxOccupancy: 4, price: 320 },
  { code: "FBH", name: "Family Beach House", baseOccupancy: 4, maxOccupancy: 6, price: 540 },
]

const LAGOON_ROOMS = [
  { type: "GDN", numbers: ["G01", "G02", "G03", "G04"] },
  { type: "LPV", numbers: ["L11", "L12", "L13"] },
  { type: "FBH", numbers: ["F21", "F22"] },
]

async function seedLagoonProperty(prisma: Tx, enterpriseId: string) {
  const property = await prisma.property.upsert({
    where: { code: "VEYO-LAGOON" },
    update: { businessDate: BUSINESS_DATE },
    create: {
      enterpriseId,
      name: "Veyo Lagoon Retreat",
      legalName: "Veyo Hospitality Pvt Ltd",
      code: "VEYO-LAGOON",
      defaultCurrency: "USD",
      timeZone: "Indian/Maldives",
      checkInTime: "15:00",
      checkOutTime: "11:00",
      contactEmail: "reception@veyolagoon.com",
      contactPhone: "+960 555 0200",
      address: "Raa Atoll, Maldives",
      businessDate: BUSINESS_DATE,
      status: "ACTIVE",
    },
  })

  let building = await prisma.building.findFirst({ where: { propertyId: property.id } })
  if (!building) building = await prisma.building.create({ data: { propertyId: property.id, name: "Lagoon Wing" } })
  let floor = await prisma.floor.findFirst({ where: { buildingId: building.id } })
  if (!floor) floor = await prisma.floor.create({ data: { buildingId: building.id, name: "Beach Level" } })

  const roomTypeByCode: Record<string, { id: string }> = {}
  for (const rt of LAGOON_ROOM_TYPES) {
    const existing = await prisma.roomType.findFirst({ where: { propertyId: property.id, code: rt.code } })
    roomTypeByCode[rt.code] =
      existing ??
      (await prisma.roomType.create({
        data: {
          propertyId: property.id,
          code: rt.code,
          name: rt.name,
          baseOccupancy: rt.baseOccupancy,
          maxOccupancy: rt.maxOccupancy,
        },
      }))
  }

  for (const group of LAGOON_ROOMS) {
    for (const roomNumber of group.numbers) {
      await prisma.room.upsert({
        where: { propertyId_roomNumber: { propertyId: property.id, roomNumber } },
        update: {},
        create: {
          propertyId: property.id,
          floorId: floor.id,
          roomTypeId: roomTypeByCode[group.type].id,
          roomNumber,
          status: "CLEAN",
        },
      })
    }
  }

  // Base Rate is what a property gets at onboarding; the calendar behind it is what makes
  // Night Audit post a real figure instead of $0.
  const baseRate = await prisma.ratePlan.upsert({
    where: { propertyId_code: { propertyId: property.id, code: "BASE" } },
    update: {},
    create: { propertyId: property.id, code: "BASE", name: "Base Rate", priority: 999, isLocked: true },
  })
  const bar = await prisma.ratePlan.upsert({
    where: { propertyId_code: { propertyId: property.id, code: "BAR" } },
    update: {},
    create: { propertyId: property.id, code: "BAR", name: "Best Available Rate", description: "Standard flexible rate" },
  })

  if ((await prisma.priceCalendar.count({ where: { ratePlanId: baseRate.id } })) === 0) {
    const rows: Prisma.PriceCalendarCreateManyInput[] = []
    for (const rt of LAGOON_ROOM_TYPES) {
      // A year forward AND 60 days back, so historic folios and past-date reports have
      // pricing behind them too.
      for (let d = -60; d < 365; d++) {
        rows.push({
          ratePlanId: baseRate.id,
          roomTypeId: roomTypeByCode[rt.code].id,
          date: bizPlus(d),
          price: rt.price,
          extraAdultPrice: Math.round(rt.price * 0.15),
          extraChildPrice: Math.round(rt.price * 0.08),
        })
      }
    }
    await prisma.priceCalendar.createMany({ data: rows })
  }

  return { property, roomTypeByCode, baseRate, bar }
}

// ── Outlets ───────────────────────────────────────────────────────────────────────
//
// Different per property — the resort runs a restaurant and a spa, the retreat a beach
// grill and a dive shop — so an outlet-scoped bill, the POS charge-code pool and the
// per-outlet check numbering all have something distinct to show on each.
const OUTLETS: Record<string, Array<{ code: string; name: string; type: string; email: string; phone: string; taxNo: string }>> = {
  "VEYO-MAIN": [
    { code: "REST", name: "Coral Restaurant", type: "RESTAURANT", email: "dining@veyo.com", phone: "+960 555 0110", taxNo: "GST-REST-1001" },
    { code: "SPA", name: "Serenity Spa", type: "SPA", email: "spa@veyo.com", phone: "+960 555 0120", taxNo: "GST-SPA-1002" },
  ],
  "VEYO-LAGOON": [
    { code: "GRILL", name: "Lagoon Beach Grill", type: "RESTAURANT", email: "grill@veyolagoon.com", phone: "+960 555 0210", taxNo: "GST-GRILL-2001" },
    { code: "DIVE", name: "Blue Water Dive Centre", type: "RECREATION", email: "dive@veyolagoon.com", phone: "+960 555 0220", taxNo: "GST-DIVE-2002" },
  ],
}

async function seedOutlets(prisma: Tx, enterpriseId: string, propertyId: string, propertyCode: string) {
  for (const def of OUTLETS[propertyCode] ?? []) {
    const outlet = await prisma.outlet.upsert({
      where: { propertyId_code: { propertyId, code: def.code } },
      update: {},
      create: {
        propertyId,
        code: def.code,
        name: def.name,
        outletType: def.type,
        email: def.email,
        phone: def.phone,
        taxNo: def.taxNo,
        address: propertyCode === "VEYO-MAIN" ? "North Male Atoll, Maldives" : "Raa Atoll, Maldives",
      },
    })
    // Outlet-wise subgroups: each outlet owns its own nnRV subgroup with its own 4-digit
    // codes (the first outlet of each kind adopts the seeded band default), exactly as
    // creating the outlet from Controls would.
    await provisionOutletSubgroup(prisma, {
      enterpriseId,
      outletId: outlet.id,
      outletName: outlet.name,
      outletType: def.type,
    })
  }
}

/**
 * Write a folio charge the way postCharge writes one: net on the charge line, with the
 * Service Charge and GST on their OWN lines against the group's tax codes and linked
 * back via generatedFromLineItemId.
 *
 * Hand-written rather than calling postCharge so the seed stays independent of a running
 * server — but the SHAPE matches exactly, so a seeded folio and a Night-Audit folio read
 * identically in every report and folio style.
 */
async function postSeedCharge(
  prisma: Tx,
  opts: {
    folioId: string
    codeId: (c: string) => string
    chargeCode: string
    description: string
    net: number
    date: Date
    taxed?: boolean
    outletId?: string | null
  }
) {
  const { folioId, codeId, chargeCode, description, net, date, outletId } = opts
  const taxed = opts.taxed ?? true
  const parent = await prisma.folioLineItem.create({
    data: { folioId, chargeCodeId: codeId(chargeCode), date, description, amount: net, taxAmount: 0, serviceChargeAmount: 0, outletId: outletId ?? null },
  })
  if (!taxed) return parent
  const svc = Math.round(net * 0.1 * 100) / 100
  const gst = Math.round((net + svc) * 0.17 * 100) / 100
  // The single global tax codes — WHICH main code produced each tax line is carried by
  // generatedFromLineItemId, not by the tax code's identity.
  await prisma.folioLineItem.create({
    data: { folioId, chargeCodeId: codeId(TAX_CODES.serviceCharge), date, description: "Service Charge", amount: 0, serviceChargeAmount: svc, taxAmount: 0, generatedFromLineItemId: parent.id, outletId: outletId ?? null },
  })
  await prisma.folioLineItem.create({
    data: { folioId, chargeCodeId: codeId(TAX_CODES.gst), date, description: "GST", amount: 0, taxAmount: gst, serviceChargeAmount: 0, generatedFromLineItemId: parent.id, outletId: outletId ?? null },
  })
  return parent
}

// ── Reservations ──────────────────────────────────────────────────────────────────
//
// The spread front office actually needs to see on a given day: people arriving, people
// in house, people leaving, plus the history and the exceptions that make reports and
// Debtors non-empty. Positions are relative to the business date, never wall clock.
type ResSpec = {
  status: string
  /** Check-in offset from the business date, in days. */
  inOff: number
  /** Check-out offset from the business date, in days. */
  outOff: number
  adults: number
  children?: number
  infants?: number
  mealPlan?: string
  /** Assign a room and open a folio — everything from checked-in onwards. */
  assign?: boolean
  /** Post room + F&B charges and (for history) settle them. */
  charges?: "none" | "open" | "settled"
  requests?: string[]
}

const RESERVATION_MIX: ResSpec[] = [
  // Arrivals due today — the check-in queue.
  { status: "RESERVED", inOff: 0, outOff: 3, adults: 2, mealPlan: "BB", requests: ["HIGH_FLOOR"] },
  { status: "RESERVED", inOff: 0, outOff: 5, adults: 2, children: 1, mealPlan: "HB" },
  { status: "RESERVED", inOff: 0, outOff: 2, adults: 1 },
  { status: "RESERVED", inOff: 0, outOff: 7, adults: 2, children: 2, infants: 1, mealPlan: "FB", requests: ["EARLY_CHECKIN"] },

  // In house — mid-stay, with charges already posted.
  { status: "IN_HOUSE", inOff: -2, outOff: 3, adults: 2, mealPlan: "BB", assign: true, charges: "open" },
  { status: "IN_HOUSE", inOff: -1, outOff: 4, adults: 2, children: 1, mealPlan: "HB", assign: true, charges: "open" },
  { status: "IN_HOUSE", inOff: -4, outOff: 2, adults: 1, assign: true, charges: "open" },

  // Departures due today — the check-out queue, balance outstanding.
  { status: "IN_HOUSE", inOff: -3, outOff: 0, adults: 2, mealPlan: "BB", assign: true, charges: "open" },
  { status: "IN_HOUSE", inOff: -5, outOff: 0, adults: 2, children: 2, mealPlan: "FB", assign: true, charges: "open" },

  // History — closed folios so revenue reports and guest stay stats aren't empty.
  { status: "CHECKED_OUT", inOff: -12, outOff: -8, adults: 2, assign: true, charges: "settled" },
  { status: "CHECKED_OUT", inOff: -20, outOff: -15, adults: 2, children: 1, assign: true, charges: "settled" },

  // Exceptions — these drive the no-show/cancellation fee paths and the reports.
  { status: "CANCELLED", inOff: -6, outOff: -3, adults: 2 },
  { status: "NO_SHOW", inOff: -2, outOff: 1, adults: 1 },

  // Future — the availability grid, tape chart and forecast need on-the-books demand.
  { status: "RESERVED", inOff: 4, outOff: 8, adults: 2, mealPlan: "BB" },
  { status: "RESERVED", inOff: 9, outOff: 12, adults: 2, children: 1 },
  { status: "RESERVED", inOff: 15, outOff: 19, adults: 2, mealPlan: "HB" },
  { status: "RESERVED", inOff: 22, outOff: 26, adults: 4, mealPlan: "FB" },
]

export async function seedDemoData(
  prisma: PrismaClient,
  opts: { enterpriseId: string; adminUserId: string; passwordHash: string; adminRoleId: string }
) {
  const { enterpriseId, adminUserId, passwordHash, adminRoleId } = opts

  // Pin the business date on every property — the whole dataset hangs off it.
  await prisma.property.updateMany({ where: { enterpriseId }, data: { businessDate: BUSINESS_DATE } })

  const lagoonSetup = await seedLagoonProperty(prisma, enterpriseId)
  const lagoon = lagoonSetup.property

  // Property-scoped admins, one per property. These are what actually exercise
  // per-property scoping: each sees only their own work location, and neither can reach
  // the Hub (hasHubAccess blocks a PROPERTY-scoped user outright, whatever the role
  // grants). The enterprise-scoped admin@veyo.mv sees both.
  const mainProperty = await prisma.property.findUniqueOrThrow({ where: { code: "VEYO-MAIN" } })
  for (const u of [
    { email: "admin.main@veyo.mv", firstName: "Main", lastName: "Admin", propertyId: mainProperty.id },
    { email: "admin.lagoon@veyo.mv", firstName: "Lagoon", lastName: "Admin", propertyId: lagoon.id },
  ]) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { propertyId: u.propertyId, scope: "PROPERTY" },
      create: {
        enterpriseId,
        email: u.email,
        passwordHash,
        firstName: u.firstName,
        lastName: u.lastName,
        roles: { create: { roleId: adminRoleId } },
        scope: "PROPERTY",
        propertyId: u.propertyId,
      },
    })
  }

  // Charge codes and fee rules are enterprise-level, so this picks up the new property's
  // fee rules without touching the first property's.
  await ensureChargeTree(prisma, enterpriseId)
  await ensureFeeRules(prisma, enterpriseId)

  const properties = await prisma.property.findMany({ where: { enterpriseId }, orderBy: { code: "asc" } })
  for (const p of properties) await seedOutlets(prisma, enterpriseId, p.id, p.code)

  const guests = await prisma.profile.findMany({ where: { enterpriseId, profileType: "GUEST" }, orderBy: { createdAt: "asc" } })
  if (guests.length === 0) throw new Error("seedDemoData: no guest profiles — run the profile seed first")

  const codes = await prisma.chargeCode.findMany({ where: { enterpriseId }, select: { id: true, code: true } })
  const codeId = (c: string) => codes.find((x) => x.code === c)!.id
  // Each outlet's own nnRV subgroup was just provisioned — resolve a property's outlet
  // code by type + template suffix (21RV restaurant -> dinner 2103), falling back to the
  // band default when the property has no outlet of that kind.
  const outletSubgroups = await prisma.chargeSubgroup.findMany({
    where: { enterpriseId, outletId: { not: null } },
    select: { code: true, outlet: { select: { propertyId: true, outletType: true } } },
  })
  const outletCode = (propertyId: string, outletType: string, suffix: string, fallback: string) => {
    const sg = outletSubgroups.find((x) => x.outlet?.propertyId === propertyId && x.outlet?.outletType === outletType)
    return sg ? `${sg.code.slice(0, 2)}${suffix}` : fallback
  }
  const methods = await prisma.paymentMethod.findMany({ where: { enterpriseId } })
  const cardMethod = methods.find((m) => m.type === "CARD") ?? methods[0]

  let guestCursor = 0
  const nextGuest = () => guests[guestCursor++ % guests.length]

  for (const property of properties) {
    // Skip a property that already has reservations — this seed is re-runnable and must
    // not stack a second set of arrivals on top of the first.
    if ((await prisma.reservation.count({ where: { propertyId: property.id } })) > 0) continue

    const rooms = await prisma.room.findMany({ where: { propertyId: property.id }, orderBy: { roomNumber: "asc" } })
    const bar = await prisma.ratePlan.findFirst({ where: { propertyId: property.id, code: "BAR" } })
    const ratePlanId = bar?.id ?? (await prisma.ratePlan.findFirstOrThrow({ where: { propertyId: property.id, isLocked: true } })).id
    if (rooms.length === 0) continue

    const shift = await prisma.cashierShift.create({
      data: { enterpriseId, userId: adminUserId, propertyId: property.id, businessDate: BUSINESS_DATE, openingFloat: 300 },
    })

    let roomCursor = 0
    for (const spec of RESERVATION_MIX) {
      const guest = nextGuest()
      const room = rooms[roomCursor++ % rooms.length]
      const checkIn = bizPlus(spec.inOff)
      const checkOut = bizPlus(spec.outOff)
      const nights = Math.max(1, spec.outOff - spec.inOff)

      const reservation = await prisma.reservation.create({
        data: {
          propertyId: property.id,
          confirmationNo: conf(property.code === "VEYO-MAIN" ? "VM" : "VL"),
          primaryGuestId: guest.upid,
          checkInDate: checkIn,
          checkOutDate: checkOut,
          status: spec.status,
          adults: spec.adults,
          children: spec.children ?? 0,
          infants: spec.infants ?? 0,
          mealPlan: spec.mealPlan ?? "NONE",
          ...(spec.status === "NO_SHOW" ? { noShowAt: BUSINESS_DATE } : {}),
          ...(spec.requests?.length
            ? { specialRequests: { create: spec.requests.map((code) => ({ code })) } }
            : {}),
          ...(spec.assign
            ? {
                assignments: {
                  create: [{
                    roomId: room.id,
                    roomTypeId: room.roomTypeId,
                    ratePlanId,
                    startDate: checkIn,
                    endDate: checkOut,
                  }],
                },
              }
            : {}),
        },
      })

      if (!spec.charges || spec.charges === "none") continue

      const settled = spec.charges === "settled"
      const folio = await prisma.folio.create({
        data: {
          reservationId: reservation.id,
          propertyId: property.id,
          folioNumber: 1,
          isClosed: settled,
          ...(settled ? { closedBusinessDate: checkOut } : {}),
        },
      })

      const roomNet = 250
      const post = (chargeCode: string, description: string, net: number, date: Date, taxed = true) =>
        postSeedCharge(prisma, { folioId: folio.id, codeId, chargeCode, description, net, date, taxed })

      // Room revenue is posted by Night Audit, so it exists for nights ALREADY audited —
      // up to but not including the business date, which hasn't been run yet. Leaving
      // tonight unposted is the honest state and is what makes running End-of-Day in the
      // demo actually do something.
      const postedNights = Math.min(nights, Math.max(0, -spec.inOff))
      for (let n = 0; n < postedNights; n++) {
        const date = bizPlus(spec.inOff + n)
        await post("1000", "Nightly Room Charge", roomNet, date)
        // Green Tax is a levy: face value, never itself taxed.
        await post("8500", "Green Tax", 12 * spec.adults + 6 * (spec.children ?? 0), date, false)
      }

      // Outlet sales, by contrast, are posted by front office DURING the day — so an
      // in-house guest has some dated today. Without these the dashboard's revenue tiles
      // read zero on a freshly seeded database and look broken rather than pre-audit.
      if (spec.status === "IN_HOUSE") {
        await post(outletCode(property.id, "RESTAURANT", "03", "2003"), "Dinner — restaurant", 85 + spec.adults * 15, BUSINESS_DATE)
        if (spec.adults > 1) await post(outletCode(property.id, "RESTAURANT", "04", "2004"), "Bar tab", 42, BUSINESS_DATE)
        if ((spec.children ?? 0) > 0) await post(outletCode(property.id, "SPA", "01", "3001"), "Massage — 60 min", 120, BUSINESS_DATE)
      } else if (postedNights > 0) {
        await post(outletCode(property.id, "RESTAURANT", "03", "2003"), "Dinner — restaurant", 85, bizPlus(spec.inOff))
      }

      if (settled) {
        const lines = await prisma.folioLineItem.findMany({ where: { folioId: folio.id } })
        const total = lines.reduce((s, l) => s + l.amount + l.taxAmount + l.serviceChargeAmount, 0)
        await prisma.payment.create({
          data: {
            folioId: folio.id,
            paymentMethodId: cardMethod.id,
            shiftId: shift.id,
            chargeCodeId: cardMethod.chargeCodeId,
            amount: Math.round(total * 100) / 100,
          },
        })
        await prisma.profile.update({
          where: { upid: guest.upid },
          data: {
            totalStays: { increment: 1 },
            totalNights: { increment: nights },
            totalRevenue: { increment: Math.round(total * 100) / 100 },
            lastStayDate: checkOut,
          },
        })
      }

      // Occupied rooms read Dirty mid-stay, which is what Housekeeping expects to see.
      if (spec.assign && spec.status === "IN_HOUSE") {
        await prisma.room.update({ where: { id: room.id }, data: { status: "DIRTY" } })
      }
    }

    await seedGroupBlock(prisma, { property, ratePlanId, enterpriseId, guests, codeId })
    await seedOperations(prisma, property.id)
  }

  // Handed back so the caller can hang the Spa and Excursions add-ons off the Lagoon
  // property — they are sold there only.
  return { lagoon, mainProperty }
}

// ── Group block ───────────────────────────────────────────────────────────────────
//
// A corporate block with room holds and picked-up reservations, billing to the block's
// master folio — the shape the Groups module and the bill-to-master routing exist for.
async function seedGroupBlock(
  prisma: Tx,
  opts: {
    property: { id: string; code: string }
    ratePlanId: string
    enterpriseId: string
    guests: Array<{ upid: string }>
    codeId: (c: string) => string
  }
) {
  const { property, ratePlanId, enterpriseId, guests, codeId } = opts
  const code = property.code === "VEYO-MAIN" ? "GRP-ATOLL" : "GRP-DIVE"
  if (await prisma.groupBlock.findFirst({ where: { propertyId: property.id, code } })) return

  const company =
    (await prisma.profile.findFirst({ where: { enterpriseId, profileType: "COMPANY" } })) ??
    (await prisma.profile.create({
      data: { enterpriseId, profileType: "COMPANY", companyName: "Atoll Marine Research", firstName: "Atoll Marine Research" },
    }))

  const roomTypes = await prisma.roomType.findMany({ where: { propertyId: property.id }, orderBy: { code: "asc" } })
  const block = await prisma.groupBlock.create({
    data: {
      propertyId: property.id,
      code,
      name: property.code === "VEYO-MAIN" ? "Atoll Marine Conference" : "Dive Club Charter",
      startDate: bizPlus(2),
      endDate: bizPlus(6),
      cutoffDate: bizPlus(1),
      status: "DEFINITE",
      payeeProfileId: company.upid,
      totalRoomsHeld: 5,
      roomHolds: {
        create: [
          { roomTypeId: roomTypes[0].id, quantity: 3 },
          ...(roomTypes[1] ? [{ roomTypeId: roomTypes[1].id, quantity: 2 }] : []),
        ],
      },
    },
  })

  // The master (PM) folio the pickups bill to — City Ledger, so closing it finalizes a
  // debtor invoice for the company and the Debtors module has something in it.
  const master = await prisma.folio.create({
    data: {
      propertyId: property.id,
      groupBlockId: block.id,
      folioNumber: 1,
      isMaster: true,
      settlementMethod: "CITY_LEDGER",
      payeeProfileId: company.upid,
    },
  })

  const rooms = await prisma.room.findMany({ where: { propertyId: property.id }, orderBy: { roomNumber: "desc" }, take: 3 })
  for (let i = 0; i < Math.min(3, rooms.length); i++) {
    const guest = guests[(i + 5) % guests.length]
    await prisma.reservation.create({
      data: {
        propertyId: property.id,
        confirmationNo: conf("GRP"),
        primaryGuestId: guest.upid,
        groupBlockId: block.id,
        groupBillToMaster: true,
        checkInDate: bizPlus(2),
        checkOutDate: bizPlus(6),
        status: "RESERVED",
        adults: 2,
        assignments: {
          create: [{ roomId: rooms[i].id, roomTypeId: rooms[i].roomTypeId, ratePlanId, startDate: bizPlus(2), endDate: bizPlus(6) }],
        },
      },
    })
  }

  // One charge already on the master so the block bill isn't empty.
  await prisma.folioLineItem.create({
    data: { folioId: master.id, chargeCodeId: codeId("6002"), date: BUSINESS_DATE, description: "Conference room hire", amount: 400, taxAmount: 0, serviceChargeAmount: 0 },
  })
}

// ── Housekeeping & maintenance ────────────────────────────────────────────────────
async function seedOperations(prisma: Tx, propertyId: string) {
  const rooms = await prisma.room.findMany({ where: { propertyId }, orderBy: { roomNumber: "asc" } })
  if (rooms.length === 0) return
  if ((await prisma.housekeepingTask.count({ where: { room: { propertyId } } })) > 0) return

  // A spread of statuses so the Housekeeping board isn't a single column.
  for (const [i, room] of rooms.entries()) {
    const status = i % 4 === 0 ? "INSPECTED" : i % 4 === 1 ? "DIRTY" : i % 4 === 2 ? "CLEAN" : "DIRTY"
    // Never overwrite a room the reservation pass already marked dirty for an in-house guest.
    const current = await prisma.room.findUniqueOrThrow({ where: { id: room.id }, select: { status: true } })
    if (current.status === "CLEAN") await prisma.room.update({ where: { id: room.id }, data: { status } })

    await prisma.housekeepingTask.create({
      data: {
        roomId: room.id,
        taskType: i % 3 === 0 ? "CHECKOUT" : "FULL_SERVICE",
        status: i % 3 === 0 ? "COMPLETED" : i % 3 === 1 ? "IN_PROGRESS" : "PENDING",
        priority: i % 5 === 0 ? "HIGH" : "NORMAL",
        scheduledDate: BUSINESS_DATE,
        ...(i % 3 === 0 ? { completedAt: BUSINESS_DATE } : {}),
      },
    })
  }

  // One room genuinely out of order, plus a couple of open tickets.
  const ooo = rooms[rooms.length - 1]
  await prisma.room.update({ where: { id: ooo.id }, data: { status: "OUT_OF_ORDER" } })
  await prisma.roomMaintenance.createMany({
    data: [
      { roomId: ooo.id, issueType: "PLUMBING", description: "Shower mixer leaking — room held out of inventory", priority: "HIGH", status: "OPEN" },
      { roomId: rooms[0].id, issueType: "ELECTRICAL", description: "Bedside lamp flickering", priority: "LOW", status: "OPEN" },
      { roomId: rooms[1 % rooms.length].id, issueType: "GENERAL", description: "Balcony door stiff", priority: "MEDIUM", status: "RESOLVED" },
    ],
  })
}

// ── Spa & Excursion bookings ──────────────────────────────────────────────────────
//
// Both add-ons are sold at the Lagoon property only, so their bookings belong to its
// in-house guests. Statuses are spread across the lifecycle — a booking sitting in
// CONFIRMED, one already CHECKED_IN, one COMPLETED and paid, one CANCELLED — because a
// scheduler that only ever shows CONFIRMED proves nothing about the other transitions.
//
// Charged bookings post through postSeedCharge, so a spa treatment on a guest's folio
// carries SVCSPA/GSTSPA and an excursion carries SVCEXC/GSTEXC, exactly as the live
// routes would write them.
export async function seedSpaAndExcursionBookings(
  prisma: PrismaClient,
  opts: { enterpriseId: string; propertyId: string; bookedByUserId: string }
) {
  const { enterpriseId, propertyId, bookedByUserId } = opts

  const codes = await prisma.chargeCode.findMany({ where: { enterpriseId }, select: { id: true, code: true } })
  const codeId = (c: string) => codes.find((x) => x.code === c)!.id
  // Each outlet's own nnRV subgroup was just provisioned — resolve a property's outlet
  // code by type + template suffix (21RV restaurant -> dinner 2103), falling back to the
  // band default when the property has no outlet of that kind.
  const outletSubgroups = await prisma.chargeSubgroup.findMany({
    where: { enterpriseId, outletId: { not: null } },
    select: { code: true, outlet: { select: { propertyId: true, outletType: true } } },
  })
  const outletCode = (propertyId: string, outletType: string, suffix: string, fallback: string) => {
    const sg = outletSubgroups.find((x) => x.outlet?.propertyId === propertyId && x.outlet?.outletType === outletType)
    return sg ? `${sg.code.slice(0, 2)}${suffix}` : fallback
  }

  // In-house guests with an open folio — the only ones a room-posted booking can bill to.
  const inHouse = await prisma.reservation.findMany({
    where: { propertyId, status: "IN_HOUSE", folios: { some: { isClosed: false } } },
    include: { folios: { where: { isClosed: false }, take: 1 } },
    orderBy: { confirmationNo: "asc" },
  })
  if (inHouse.length === 0) return { spa: 0, excursions: 0 }

  // ── Spa appointments ──
  let spaCount = 0
  if ((await prisma.spaAppointment.count({ where: { propertyId } })) === 0) {
    const treatments = await prisma.spaTreatment.findMany({
      where: { propertyId },
      include: { rates: { where: { isActive: true }, orderBy: { effectiveFrom: "desc" }, take: 1 } },
      orderBy: { name: "asc" },
    })
    const rooms = await prisma.spaRoom.findMany({ where: { propertyId }, orderBy: { name: "asc" } })
    const therapists = await prisma.spaTherapist.findMany({ where: { propertyId }, orderBy: { displayName: "asc" } })

    if (treatments.length > 0 && rooms.length > 0 && therapists.length > 0) {
      const plan: Array<{ status: string; payment: string; dayOff: number; time: string; charge: boolean }> = [
        { status: "CONFIRMED", payment: "NOT_POSTED", dayOff: 0, time: "10:00", charge: false },
        { status: "CONFIRMED", payment: "POSTED_TO_FOLIO", dayOff: 0, time: "14:00", charge: true },
        { status: "CHECKED_IN", payment: "POSTED_TO_FOLIO", dayOff: 0, time: "11:30", charge: true },
        { status: "COMPLETED", payment: "POSTED_TO_FOLIO", dayOff: -1, time: "16:00", charge: true },
        { status: "CANCELLED", payment: "NOT_POSTED", dayOff: -1, time: "09:00", charge: false },
        { status: "CONFIRMED", payment: "NOT_POSTED", dayOff: 2, time: "15:00", charge: false },
      ]

      for (const [i, p] of plan.entries()) {
        const res = inHouse[i % inHouse.length]
        const folio = res.folios[0]
        const treatment = treatments[i % treatments.length]
        const room = rooms[i % rooms.length]
        const date = bizPlus(p.dayOff)
        const price = treatment.rates[0]?.price ?? 0
        if (!price) continue

        const [h, m] = p.time.split(":").map(Number)
        const endMins = h * 60 + m + treatment.defaultDurationMinutes
        const hhmm = (mins: number) => `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`

        const line = p.charge
          ? await postSeedCharge(prisma, {
              folioId: folio.id,
              codeId,
              chargeCode: outletCode(propertyId, "SPA", "01", "3001"),
              description: `${treatment.name} — ${date.toISOString().slice(0, 10)} ${p.time}`,
              net: price,
              date,
            })
          : null

        await prisma.spaAppointment.create({
          data: {
            propertyId,
            treatmentId: treatment.id,
            treatmentNameSnapshot: treatment.name,
            durationMinutesSnapshot: treatment.defaultDurationMinutes,
            preparationBufferMinutesSnapshot: treatment.preparationBufferMinutes ?? 0,
            cleanupBufferMinutesSnapshot: treatment.cleanupBufferMinutes ?? 0,
            partySize: 1,
            priceSnapshot: price,
            currencySnapshot: "USD",
            appointmentDate: date,
            startTime: p.time,
            treatmentEndTime: hhmm(endMins),
            blockedUntilTime: hhmm(endMins + (treatment.cleanupBufferMinutes ?? 0)),
            roomId: room.id,
            appointmentStatus: p.status,
            paymentStatus: p.payment,
            source: "FRONT_DESK",
            folioId: p.charge ? folio.id : null,
            folioLineItemId: line?.id ?? null,
            bookedByUserId,
            ...(p.status === "CHECKED_IN" ? { checkedInAt: date } : {}),
            ...(p.status === "COMPLETED" ? { checkedInAt: date, completedAt: date, completedByUserId: bookedByUserId } : {}),
            ...(p.status === "CANCELLED" ? { cancelledAt: date, cancelledByUserId: bookedByUserId, cancellationReasonCode: "GUEST_REQUEST" } : {}),
            participants: { create: [{ participantIndex: 1, reservationId: res.id, therapistId: therapists[i % therapists.length].id }] },
          },
        })
        spaCount += 1
      }
    }
  }

  // ── Excursion bookings ──
  let excCount = 0
  if ((await prisma.excursionBooking.count({ where: { propertyId } })) === 0) {
    // Upcoming departures with room to sell, nearest first.
    const departures = await prisma.excursionDeparture.findMany({
      where: { excursionType: { propertyId }, departureDate: { gte: bizPlus(0) } },
      include: { excursionType: { include: { rates: true } } },
      orderBy: [{ departureDate: "asc" }, { departureTime: "asc" }],
      take: 12,
    })

    const plan: Array<{ status: string; adults: number; children: number; charge: boolean }> = [
      { status: "CONFIRMED", adults: 2, children: 0, charge: true },
      { status: "CONFIRMED", adults: 2, children: 2, charge: true },
      { status: "CONFIRMED", adults: 1, children: 0, charge: true },
      { status: "COMPLETED", adults: 2, children: 1, charge: true },
      { status: "CANCELLED", adults: 2, children: 0, charge: false },
    ]

    for (const [i, p] of plan.entries()) {
      const departure = departures[i % Math.max(1, departures.length)]
      if (!departure) break
      const res = inHouse[i % inHouse.length]
      const folio = res.folios[0]
      const rate = departure.excursionType.rates[0]
      if (!rate) continue

      const total = Math.round((p.adults * rate.adultPrice + p.children * rate.childPrice) * 100) / 100
      const line = p.charge
        ? await postSeedCharge(prisma, {
            folioId: folio.id,
            codeId,
            chargeCode: outletCode(propertyId, "RECREATION", "01", "4001"),
            description: `${departure.excursionType.name} — ${departure.departureDate.toISOString().slice(0, 10)} ${departure.departureTime}`,
            net: total,
            date: bizPlus(0),
          })
        : null

      await prisma.excursionBooking.create({
        data: {
          departureId: departure.id,
          propertyId,
          reservationId: res.id,
          adultCount: p.adults,
          childCount: p.children,
          infantCount: 0,
          totalAmount: total,
          status: p.status,
          folioId: folio.id,
          folioLineItemId: line?.id ?? null,
          bookedByUserId,
        },
      })
      excCount += 1
    }
  }

  return { spa: spaCount, excursions: excCount }
}
