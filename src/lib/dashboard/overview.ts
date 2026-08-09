// The Operations Dashboard payload builder.
//
// ONE rule governs this whole file: **a section is only computed when the caller holds
// `canView` on the module that owns it.** Presence of a key in the returned object IS
// the permission signal the UI reads — a tile whose section is absent is never rendered
// (see src/components/dashboard/operations-dashboard.tsx). That means the gate is
// enforced server-side, on the data itself, not merely by hiding a component: a user
// without REVENUE cannot see ADR by opening devtools, because ADR was never sent.
//
// The gate is also the performance story — an unauthorized section's queries are never
// issued, so a Housekeeping-only user's dashboard runs three queries, not thirty.
//
// Revenue is bucketed exactly the way the EOD/financial reports do it
// (`lineReportBucket`, total = amount + tax + service charge), so the numbers on this
// screen reconcile against the reports rather than telling a second story.

import { prisma } from "@/lib/db";
import { ReservationStatus } from "@/lib/enums";
import { hasPermission, hasHubAccess, type AuthContext, type Module } from "@/lib/scope";
import { resolveBusinessDate, toUtcMidnight } from "@/lib/business-date";
import { CHARGE_BUCKET_SELECT, lineReportBucket, reportBucketLabel } from "@/lib/posting/report-bucket";
import { computeFolioBalance } from "@/lib/debtor-accounts";
import { computeFolioAgingBuckets, totalOutstanding, type AgingBuckets } from "@/lib/debtor-aging";
import { round2, sumMoney } from "@/lib/money";
import { CONNECTION_STATUS } from "@/lib/channels/connection";
import type { ReportBucket } from "@/lib/posting/charge-tree";

// ── Shapes ────────────────────────────────────────────────────────────────────────

export type TrendPoint = {
  date: string; // YYYY-MM-DD (UTC)
  /** Dates after the business date are on-the-books forecast, drawn differently. */
  future: boolean;
  /** Rooms sold that night — null when the caller can't see occupancy. */
  roomsSold: number | null;
  occupancy: number | null;
  /** Posted revenue. Always null for future dates — nothing has been posted yet. */
  roomRevenue: number | null;
  totalRevenue: number | null;
  adr: number | null;
  revpar: number | null;
};

export type BucketAmount = { bucket: string; label: string; amount: number };

export type OverviewWorklistRow = {
  id: string;
  confirmationNo: string;
  guestName: string;
  roomNumber: string | null;
  roomTypeName: string | null;
  nights: number;
  balance: number;
  flag: string | null;
};

export type DashboardOverview = {
  property: { id: string; name: string; currency: string; businessDate: string };
  generatedAt: string;
  trendDays: number;
  /** Sections the caller was authorized for — handy for support/debugging a "why is my tile gone". */
  visibleSections: string[];

  occupancy?: {
    totalRooms: number;
    sellableRooms: number;
    roomsSold: number;
    occupancyPct: number;
    outOfOrder: number;
    outOfService: number;
    vacantReady: number;
    vacantDirty: number;
    adults: number;
    children: number;
    infants: number;
    arrivals: { expected: number; completed: number; pending: number };
    departures: { expected: number; completed: number; pending: number };
    /** Occupancy on the same weekday a week ago, when inside the trend window. */
    occupancyPctLastWeek: number | null;
  };

  trend?: { points: TrendPoint[]; hasOccupancy: boolean; hasRevenue: boolean };

  revenue?: {
    today: { total: number; room: number; nonRoom: number; byBucket: BucketAmount[] };
    adr: number;
    revpar: number;
    adrLastWeek: number | null;
    totalRevenueLastWeek: number | null;
    monthToDate: { total: number; room: number; roomNights: number; adr: number; occupancyPct: number };
  };

  cashiering?: {
    receiptsToday: number;
    refundsToday: number;
    netToday: number;
    byMethod: { name: string; type: string; amount: number; count: number }[];
    openShifts: number;
    openFolios: number;
  };

  debtors?: {
    totalOutstanding: number;
    buckets: AgingBuckets;
    invoiceCount: number;
    overdueCount: number;
    top: { name: string; amount: number }[];
  };

  housekeeping?: {
    statusMix: { status: string; count: number }[];
    tasks: { pending: number; inProgress: number; completed: number; total: number };
    discrepancies: number;
  };

  maintenance?: {
    open: number;
    inProgress: number;
    byPriority: { priority: string; count: number }[];
    roomsOutOfService: number;
    recent: { id: string; roomNumber: string; issueType: string; priority: string; status: string; description: string }[];
  };

  reservations?: {
    pace: { date: string; created: number; cancelled: number }[];
    createdLast7: number;
    cancelledLast7: number;
    noShowLast7: number;
    avgLeadTimeDays: number | null;
    avgStayNights: number | null;
    onTheBooksNext7: number;
  };

  groups?: {
    active: { id: string; code: string; name: string; status: string; startDate: string; endDate: string; roomsHeld: number; pickedUp: number }[];
  };

  profiles?: {
    inHouseNationalities: { code: string; count: number }[];
    vipInHouse: number;
    newProfiles7d: number;
    repeatGuestPct: number | null;
  };

  nightAudit?: {
    businessDate: string;
    inProgress: boolean;
    stepsDone: number;
    totalSteps: number;
    lastCompletedAt: string | null;
    lastCompletedBusinessDate: string | null;
    daysBehind: number;
  };

  spa?: { count: number; upcoming: { id: string; startTime: string; treatment: string; guest: string; status: string }[] };

  excursions?: { count: number; departures: { id: string; time: string; name: string; booked: number; capacity: number; status: string }[] };

  pos?: { checksToday: number; salesToday: number; byOutlet: { name: string; amount: number }[] };

  integrations?: { connections: number; activeConnections: number; pendingInbound: number; failedInbound: number; syncErrors24h: number; lastSyncAt: string | null };

  activity?: { id: string; at: string; user: string; module: string; action: string; description: string }[];

  worklists?: {
    arrivals: OverviewWorklistRow[];
    departures: OverviewWorklistRow[];
    alerts: { id: string; reservationId: string; confirmationNo: string; guestName: string; traceType: string; description: string }[];
  };
};

// ── Small date helpers (everything here is UTC-midnight, like the rest of the app) ──

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (d: Date, n: number) => new Date(toUtcMidnight(d).getTime() + n * DAY_MS);
const isoDay = (d: Date) => toUtcMidnight(d).toISOString().slice(0, 10);
const TREND_DAYS_MIN = 7;
const TREND_DAYS_MAX = 60;
const FORECAST_DAYS = 7;
/** Buckets that are money the property actually earned — TAX/NON_REVENUE/SYSTEM aren't. */
const REVENUE_BUCKETS: ReadonlySet<string> = new Set<ReportBucket>(["ROOM", "FOOD_BEVERAGE", "TRANSPORT", "OTHER"]);

type LineForBucket = {
  date: Date;
  amount: number;
  taxAmount: number;
  serviceChargeAmount: number;
  chargeCode: { chargeSubgroup: { chargeGroup: { reportBucket: string | null; isRevenue: boolean } | null } | null } | null;
  generatedFrom: { chargeCode: { chargeSubgroup: { chargeGroup: { reportBucket: string | null; isRevenue: boolean } | null } | null } | null } | null;
};

/** The house convention for a line's contribution: net + its tax + its service charge. */
const lineTotal = (l: { amount: number; taxAmount: number; serviceChargeAmount: number }) =>
  l.amount + l.taxAmount + (l.serviceChargeAmount || 0);

const guestName = (p: { firstName: string | null; lastName: string | null; companyName: string | null } | null): string =>
  p ? (p.companyName?.trim() || `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "Guest") : "Guest";

// ── Builder ───────────────────────────────────────────────────────────────────────

export async function buildDashboardOverview(
  ctx: AuthContext,
  propertyId: string,
  opts: { trendDays?: number } = {}
): Promise<DashboardOverview> {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { id: true, name: true, defaultCurrency: true, businessDate: true },
  });
  if (!property) throw new Error("Property not found");

  const businessDate = resolveBusinessDate(property);
  const tomorrow = addDays(businessDate, 1);
  const todayEnd = new Date(tomorrow.getTime() - 1);

  const trendDays = Math.min(TREND_DAYS_MAX, Math.max(TREND_DAYS_MIN, Math.trunc(opts.trendDays ?? 14)));
  const trendStart = addDays(businessDate, -(trendDays - 1));
  // Exclusive upper bound covering FORECAST_DAYS nights AFTER the business date, so the
  // on-the-books tail is a full week rather than a week minus today.
  const forecastEnd = addDays(businessDate, FORECAST_DAYS + 1);
  const monthStart = new Date(Date.UTC(businessDate.getUTCFullYear(), businessDate.getUTCMonth(), 1));
  // One history window feeds both the trend and the month-to-date figures, so neither
  // needs a query of its own.
  const historyStart = trendStart < monthStart ? trendStart : monthStart;

  const can = (m: Module) => hasPermission(ctx, m, "view");
  // Spa/Excursions are sellable add-ons: the role bit alone isn't enough, the enterprise
  // must have the add-on switched on (same rule as the sidebar).
  const addOnWanted = can("SPA") || can("EXCURSIONS");
  const enabledAddOns = new Set(
    addOnWanted
      ? (
          await prisma.enterpriseAddonAccess.findMany({
            where: { enterpriseId: ctx.enterpriseId, enabled: true },
            select: { module: true },
          })
        ).map((r) => r.module)
      : []
  );
  const canAddOn = (m: Module) => can(m) && enabledAddOns.has(m);

  const showOccupancy = can("FRONT_DESK");
  const showRevenue = can("REVENUE");
  const showReservations = can("RESERVATIONS");
  // The trend chart needs the stay window whenever ANY of its consumers is visible.
  const needStays = showOccupancy || showRevenue || showReservations;

  const out: DashboardOverview = {
    property: {
      id: property.id,
      name: property.name,
      currency: property.defaultCurrency,
      businessDate: isoDay(businessDate),
    },
    generatedAt: new Date().toISOString(),
    trendDays,
    visibleSections: [],
  };

  // ── Shared reads ────────────────────────────────────────────────────────────────
  // Rooms back both occupancy and the housekeeping mix; the stay window backs occupancy,
  // the trend and the reservation pace; the covering assignments say which PHYSICAL room
  // each in-house guest is in tonight. Each is read at most once, and only when some
  // authorized section actually needs it.
  const needRooms = showOccupancy || can("HOUSEKEEPING") || can("MAINTENANCE");
  const needOccupiedRooms = showOccupancy || can("HOUSEKEEPING");
  const [rooms, stays, coveringAssignments] = await Promise.all([
    needRooms
      ? prisma.room.findMany({ where: { propertyId }, select: { id: true, status: true } })
      : Promise.resolve(null),
    needStays
      ? prisma.reservation.findMany({
          where: {
            propertyId,
            status: { notIn: [ReservationStatus.CANCELLED, ReservationStatus.NO_SHOW] },
            checkInDate: { lt: forecastEnd },
            checkOutDate: { gt: historyStart },
          },
          select: { id: true, checkInDate: true, checkOutDate: true, adults: true, children: true, infants: true, status: true },
        })
      : Promise.resolve(null),
    needOccupiedRooms
      ? prisma.roomAssignment.findMany({
          // The ONE segment whose [start, end) window covers tonight. Filtering on the
          // window rather than taking every segment is what stops a scheduled room move
          // (several segments on one stay) from counting the guest twice.
          where: {
            reservation: { propertyId, status: ReservationStatus.IN_HOUSE },
            startDate: { lte: businessDate },
            endDate: { gt: businessDate },
          },
          select: { roomId: true },
        })
      : Promise.resolve(null),
  ]);

  const totalRooms = rooms?.length ?? 0;
  const occupiedRoomIds = new Set((coveringAssignments ?? []).map((a) => a.roomId).filter((id): id is string => !!id));
  /** Rooms sold on a given night — a stay occupies one room per night, so this is a count of covering stays. */
  const roomsSoldOn = (day: Date): number => {
    if (!stays) return 0;
    const t = day.getTime();
    let n = 0;
    for (const s of stays) {
      if (toUtcMidnight(s.checkInDate).getTime() <= t && toUtcMidnight(s.checkOutDate).getTime() > t) n++;
    }
    return n;
  };

  // ── Posted revenue over the history window (one query, reused everywhere) ────────
  const revenueLines: LineForBucket[] | null = showRevenue
    ? await prisma.folioLineItem.findMany({
        where: { folio: { propertyId }, isVoid: false, date: { gte: historyStart, lte: todayEnd } },
        select: {
          date: true,
          amount: true,
          taxAmount: true,
          serviceChargeAmount: true,
          chargeCode: { select: CHARGE_BUCKET_SELECT },
          generatedFrom: { select: { chargeCode: { select: CHARGE_BUCKET_SELECT } } },
        },
      })
    : null;

  /** date -> bucket -> gross amount. Built once, sliced by day/bucket downstream. */
  const revenueByDay = new Map<string, Map<string, number>>();
  if (revenueLines) {
    for (const line of revenueLines) {
      const key = isoDay(line.date);
      const bucket = lineReportBucket(line);
      const perBucket = revenueByDay.get(key) ?? new Map<string, number>();
      perBucket.set(bucket, (perBucket.get(bucket) ?? 0) + lineTotal(line));
      revenueByDay.set(key, perBucket);
    }
  }
  const dayBucket = (key: string, bucket: string) => revenueByDay.get(key)?.get(bucket) ?? 0;
  const dayRevenueTotal = (key: string) => {
    const m = revenueByDay.get(key);
    if (!m) return 0;
    let sum = 0;
    for (const [bucket, amount] of m) if (REVENUE_BUCKETS.has(bucket)) sum += amount;
    return sum;
  };

  // ── Occupancy / front desk ──────────────────────────────────────────────────────
  if (showOccupancy && rooms) {
    out.visibleSections.push("occupancy");
    const byStatus = (s: string) => rooms.filter((r) => r.status === s).length;
    const outOfOrder = byStatus("OUT_OF_ORDER");
    const outOfService = byStatus("OUT_OF_SERVICE");

    const inHouse = (stays ?? []).filter((s) => s.status === ReservationStatus.IN_HOUSE);
    const roomsSold = roomsSoldOn(businessDate);
    // Vacancy is a fact about ROOMS, so it is computed against the physical rooms nobody
    // is in tonight — not against a headcount of stays, which a scheduled room move
    // would double-count.
    const vacant = rooms.filter((r) => !occupiedRoomIds.has(r.id) && r.status !== "OUT_OF_ORDER" && r.status !== "OUT_OF_SERVICE");
    const vacantReady = vacant.filter((r) => r.status === "CLEAN" || r.status === "INSPECTED").length;

    const arrivalDay = { checkInDate: { gte: businessDate, lte: todayEnd } };
    const departureDay = { checkOutDate: { gte: businessDate, lte: todayEnd } };
    const [arrivalsExpected, arrivalsDone, departuresExpected, departuresDone] = await Promise.all([
      prisma.reservation.count({
        where: { propertyId, ...arrivalDay, status: { in: [ReservationStatus.RESERVED, ReservationStatus.IN_HOUSE, ReservationStatus.CHECKED_OUT] } },
      }),
      prisma.reservation.count({
        where: { propertyId, ...arrivalDay, status: { in: [ReservationStatus.IN_HOUSE, ReservationStatus.CHECKED_OUT] } },
      }),
      prisma.reservation.count({
        where: { propertyId, ...departureDay, status: { in: [ReservationStatus.IN_HOUSE, ReservationStatus.CHECKED_OUT] } },
      }),
      prisma.reservation.count({ where: { propertyId, ...departureDay, status: ReservationStatus.CHECKED_OUT } }),
    ]);

    const lastWeek = addDays(businessDate, -7);
    const occupancyPctLastWeek =
      lastWeek >= trendStart && totalRooms > 0 ? round2((roomsSoldOn(lastWeek) / totalRooms) * 100) : null;

    out.occupancy = {
      totalRooms,
      sellableRooms: totalRooms - outOfOrder - outOfService,
      roomsSold,
      occupancyPct: totalRooms > 0 ? round2((roomsSold / totalRooms) * 100) : 0,
      outOfOrder,
      outOfService,
      vacantReady,
      vacantDirty: vacant.length - vacantReady,
      adults: inHouse.reduce((s, r) => s + r.adults, 0),
      children: inHouse.reduce((s, r) => s + r.children, 0),
      infants: inHouse.reduce((s, r) => s + r.infants, 0),
      arrivals: { expected: arrivalsExpected, completed: arrivalsDone, pending: Math.max(0, arrivalsExpected - arrivalsDone) },
      departures: { expected: departuresExpected, completed: departuresDone, pending: Math.max(0, departuresExpected - departuresDone) },
      occupancyPctLastWeek,
    };
  }

  // ── Trend (occupancy bars + ADR/revenue line, with an on-the-books tail) ─────────
  if (showOccupancy || showRevenue) {
    out.visibleSections.push("trend");
    const points: TrendPoint[] = [];
    for (let d = new Date(trendStart); d < forecastEnd; d = addDays(d, 1)) {
      const key = isoDay(d);
      const future = d > businessDate;
      const roomsSold = showOccupancy ? roomsSoldOn(d) : null;
      const roomRevenue = showRevenue && !future ? round2(dayBucket(key, "ROOM")) : null;
      const totalRevenue = showRevenue && !future ? round2(dayRevenueTotal(key)) : null;
      // ADR is room revenue over rooms SOLD, so it needs both permissions to be honest.
      // With REVENUE alone we still know room revenue, just not the divisor.
      const soldForRate = showOccupancy ? roomsSold : roomsSoldOn(d);
      points.push({
        date: key,
        future,
        roomsSold,
        occupancy: roomsSold !== null && totalRooms > 0 ? round2((roomsSold / totalRooms) * 100) : null,
        roomRevenue,
        totalRevenue,
        adr: roomRevenue !== null && soldForRate && soldForRate > 0 ? round2(roomRevenue / soldForRate) : roomRevenue !== null ? 0 : null,
        revpar: roomRevenue !== null && totalRooms > 0 ? round2(roomRevenue / totalRooms) : null,
      });
    }
    out.trend = { points, hasOccupancy: showOccupancy, hasRevenue: showRevenue };
  }

  // ── Revenue ─────────────────────────────────────────────────────────────────────
  if (showRevenue) {
    out.visibleSections.push("revenue");
    const todayKey = isoDay(businessDate);
    const todayMap = revenueByDay.get(todayKey) ?? new Map<string, number>();
    const byBucket: BucketAmount[] = [...todayMap.entries()]
      .filter(([bucket, amount]) => REVENUE_BUCKETS.has(bucket) && Math.abs(amount) > 0.005)
      .map(([bucket, amount]) => ({ bucket, label: reportBucketLabel(bucket), amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount);

    const roomToday = round2(dayBucket(todayKey, "ROOM"));
    const totalToday = round2(dayRevenueTotal(todayKey));
    // Room nights sold today drive ADR; without FRONT_DESK we still compute it, because
    // ADR is a revenue metric and REVENUE is the permission that owns it.
    const soldToday = roomsSoldOn(businessDate);

    let mtdRoom = 0;
    let mtdTotal = 0;
    let mtdRoomNights = 0;
    for (let d = new Date(monthStart); d <= businessDate; d = addDays(d, 1)) {
      const key = isoDay(d);
      mtdRoom += dayBucket(key, "ROOM");
      mtdTotal += dayRevenueTotal(key);
      mtdRoomNights += roomsSoldOn(d);
    }
    const mtdDays = Math.round((businessDate.getTime() - monthStart.getTime()) / DAY_MS) + 1;

    const lastWeekKey = isoDay(addDays(businessDate, -7));
    const inWindow = addDays(businessDate, -7) >= historyStart;
    const soldLastWeek = roomsSoldOn(addDays(businessDate, -7));

    out.revenue = {
      today: { total: totalToday, room: roomToday, nonRoom: round2(totalToday - roomToday), byBucket },
      adr: soldToday > 0 ? round2(roomToday / soldToday) : 0,
      revpar: totalRooms > 0 ? round2(roomToday / totalRooms) : 0,
      adrLastWeek: inWindow && soldLastWeek > 0 ? round2(dayBucket(lastWeekKey, "ROOM") / soldLastWeek) : null,
      totalRevenueLastWeek: inWindow ? round2(dayRevenueTotal(lastWeekKey)) : null,
      monthToDate: {
        total: round2(mtdTotal),
        room: round2(mtdRoom),
        roomNights: mtdRoomNights,
        adr: mtdRoomNights > 0 ? round2(mtdRoom / mtdRoomNights) : 0,
        occupancyPct: totalRooms > 0 && mtdDays > 0 ? round2((mtdRoomNights / (totalRooms * mtdDays)) * 100) : 0,
      },
    };
  }

  // ── Cashiering ──────────────────────────────────────────────────────────────────
  if (can("CASHIERING")) {
    out.visibleSections.push("cashiering");
    // Business-date aligned, via the shift the payment was taken on — the same anchor
    // the cashier reports use, so this agrees with the shift close-out.
    const [payments, openShifts, openFolios] = await Promise.all([
      prisma.payment.findMany({
        where: { shift: { propertyId, businessDate } },
        select: { amount: true, isRefund: true, paymentMethod: { select: { name: true, type: true } } },
      }),
      prisma.cashierShift.count({ where: { propertyId, closedAt: null } }),
      prisma.folio.count({ where: { propertyId, isClosed: false } }),
    ]);

    const methodMap = new Map<string, { name: string; type: string; amount: number; count: number }>();
    let receipts = 0;
    let refunds = 0;
    for (const p of payments) {
      const signed = p.isRefund ? -p.amount : p.amount;
      if (p.isRefund) refunds += p.amount;
      else receipts += p.amount;
      const key = `${p.paymentMethod.name}|${p.paymentMethod.type}`;
      const row = methodMap.get(key) ?? { name: p.paymentMethod.name, type: p.paymentMethod.type, amount: 0, count: 0 };
      row.amount += signed;
      row.count += 1;
      methodMap.set(key, row);
    }

    out.cashiering = {
      receiptsToday: round2(receipts),
      refundsToday: round2(refunds),
      netToday: round2(receipts - refunds),
      byMethod: [...methodMap.values()].map((m) => ({ ...m, amount: round2(m.amount) })).sort((a, b) => b.amount - a.amount),
      openShifts,
      openFolios,
    };
  }

  // ── Debtors (AR aging) ──────────────────────────────────────────────────────────
  if (can("DEBTORS")) {
    out.visibleSections.push("debtors");
    const invoices = await prisma.folio.findMany({
      where: { propertyId, isDebtorAccount: true },
      select: {
        id: true,
        reservation: { select: { checkOutDate: true } },
        payeeProfile: { select: { firstName: true, lastName: true, companyName: true } },
        lineItems: { select: { amount: true, taxAmount: true, serviceChargeAmount: true, isVoid: true } },
        payments: { select: { amount: true, isRefund: true } },
        // Folio has no createdAt; the day it was closed is the next-best "debt incurred
        // on" date for the (rare) debtor folio with no reservation behind it.
        closedBusinessDate: true,
      },
    });

    const open = invoices
      .map((f) => ({
        balance: computeFolioBalance(f.lineItems, f.payments),
        referenceDate: f.reservation?.checkOutDate ?? f.closedBusinessDate ?? businessDate,
        name: guestName(f.payeeProfile),
      }))
      .filter((i) => i.balance > 0.005);

    const buckets = computeFolioAgingBuckets(open, businessDate);
    const byAccount = new Map<string, number>();
    for (const i of open) byAccount.set(i.name, (byAccount.get(i.name) ?? 0) + i.balance);

    out.debtors = {
      totalOutstanding: round2(totalOutstanding(buckets)),
      buckets: {
        current: round2(buckets.current),
        "1-30": round2(buckets["1-30"]),
        "31-60": round2(buckets["31-60"]),
        "61-90": round2(buckets["61-90"]),
        "90+": round2(buckets["90+"]),
      },
      invoiceCount: open.length,
      overdueCount: open.filter((i) => new Date(i.referenceDate).getTime() < businessDate.getTime()).length,
      top: [...byAccount.entries()]
        .map(([name, amount]) => ({ name, amount: round2(amount) }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5),
    };
  }

  // ── Housekeeping ────────────────────────────────────────────────────────────────
  if (can("HOUSEKEEPING") && rooms) {
    out.visibleSections.push("housekeeping");
    const tasks = await prisma.housekeepingTask.groupBy({
      by: ["status"],
      where: { room: { propertyId }, scheduledDate: { gte: businessDate, lte: todayEnd } },
      _count: { _all: true },
    });
    const taskCount = (s: string) => tasks.find((t) => t.status === s)?._count._all ?? 0;
    const statusOrder = ["INSPECTED", "CLEAN", "DIRTY", "OUT_OF_ORDER", "OUT_OF_SERVICE"];
    const statusMix = statusOrder
      .map((status) => ({ status, count: rooms.filter((r) => r.status === status).length }))
      .filter((r) => r.count > 0);

    out.housekeeping = {
      statusMix,
      tasks: {
        pending: taskCount("PENDING"),
        inProgress: taskCount("IN_PROGRESS"),
        completed: taskCount("COMPLETED"),
        total: tasks.reduce((s, t) => s + t._count._all, 0),
      },
      discrepancies: rooms.filter((r) => r.status === "DIRTY" && !occupiedRoomIds.has(r.id)).length,
    };
  }

  // ── Maintenance ─────────────────────────────────────────────────────────────────
  if (can("MAINTENANCE")) {
    out.visibleSections.push("maintenance");
    const openTickets = await prisma.roomMaintenance.findMany({
      where: { room: { propertyId }, status: { in: ["OPEN", "IN_PROGRESS"] } },
      select: {
        id: true,
        issueType: true,
        priority: true,
        status: true,
        description: true,
        createdAt: true,
        room: { select: { roomNumber: true } },
      },
      orderBy: [{ createdAt: "desc" }],
    });
    const byPriority = ["HIGH", "MEDIUM", "LOW"]
      .map((priority) => ({ priority, count: openTickets.filter((t) => t.priority === priority).length }))
      .filter((r) => r.count > 0);

    out.maintenance = {
      open: openTickets.filter((t) => t.status === "OPEN").length,
      inProgress: openTickets.filter((t) => t.status === "IN_PROGRESS").length,
      byPriority,
      roomsOutOfService: rooms ? rooms.filter((r) => r.status === "OUT_OF_ORDER" || r.status === "OUT_OF_SERVICE").length : 0,
      recent: openTickets.slice(0, 5).map((t) => ({
        id: t.id,
        roomNumber: t.room.roomNumber,
        issueType: t.issueType,
        priority: t.priority,
        status: t.status,
        description: t.description,
      })),
    };
  }

  // ── Reservations (booking pace) ─────────────────────────────────────────────────
  if (showReservations) {
    out.visibleSections.push("reservations");
    const paceStart = addDays(businessDate, -(trendDays - 1));
    const [created, cancelled, noShows] = await Promise.all([
      prisma.reservation.findMany({
        where: { propertyId, createdAt: { gte: paceStart, lte: todayEnd } },
        select: { createdAt: true, checkInDate: true, checkOutDate: true },
      }),
      prisma.reservation.findMany({
        where: { propertyId, status: ReservationStatus.CANCELLED, cancelledAt: { gte: paceStart, lte: todayEnd } },
        select: { cancelledAt: true },
      }),
      prisma.reservation.count({
        where: { propertyId, status: ReservationStatus.NO_SHOW, noShowAt: { gte: addDays(businessDate, -6), lte: todayEnd } },
      }),
    ]);

    const pace: { date: string; created: number; cancelled: number }[] = [];
    for (let d = new Date(paceStart); d <= businessDate; d = addDays(d, 1)) {
      const key = isoDay(d);
      pace.push({
        date: key,
        created: created.filter((r) => isoDay(r.createdAt) === key).length,
        cancelled: cancelled.filter((r) => r.cancelledAt && isoDay(r.cancelledAt) === key).length,
      });
    }

    const last7Start = addDays(businessDate, -6);
    const leadTimes = created.map((r) => Math.round((toUtcMidnight(r.checkInDate).getTime() - toUtcMidnight(r.createdAt).getTime()) / DAY_MS));
    const stayLengths = created.map((r) => Math.max(1, Math.round((toUtcMidnight(r.checkOutDate).getTime() - toUtcMidnight(r.checkInDate).getTime()) / DAY_MS)));

    let onTheBooks = 0;
    for (let d = addDays(businessDate, 1); d < forecastEnd; d = addDays(d, 1)) onTheBooks += roomsSoldOn(d);

    out.reservations = {
      pace,
      createdLast7: created.filter((r) => r.createdAt >= last7Start).length,
      cancelledLast7: cancelled.filter((r) => r.cancelledAt && r.cancelledAt >= last7Start).length,
      noShowLast7: noShows,
      avgLeadTimeDays: leadTimes.length ? round2(leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length) : null,
      avgStayNights: stayLengths.length ? round2(stayLengths.reduce((a, b) => a + b, 0) / stayLengths.length) : null,
      onTheBooksNext7: onTheBooks,
    };
  }

  // ── Group blocks in house / arriving ────────────────────────────────────────────
  if (can("GROUP_BLOCKS")) {
    out.visibleSections.push("groups");
    const blocks = await prisma.groupBlock.findMany({
      where: { propertyId, status: { not: "CANCELLED" }, endDate: { gte: businessDate }, startDate: { lt: forecastEnd } },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        startDate: true,
        endDate: true,
        totalRoomsHeld: true,
        _count: { select: { reservations: true } },
      },
      orderBy: { startDate: "asc" },
      take: 6,
    });
    out.groups = {
      active: blocks.map((b) => ({
        id: b.id,
        code: b.code,
        name: b.name,
        status: b.status,
        startDate: isoDay(b.startDate),
        endDate: isoDay(b.endDate),
        roomsHeld: b.totalRoomsHeld,
        pickedUp: b._count.reservations,
      })),
    };
  }

  // ── Guest mix ───────────────────────────────────────────────────────────────────
  if (can("PROFILES")) {
    out.visibleSections.push("profiles");
    const [inHouseGuests, newProfiles] = await Promise.all([
      prisma.reservation.findMany({
        where: { propertyId, status: ReservationStatus.IN_HOUSE },
        select: { primaryGuest: { select: { upid: true, nationality: true, vipLevel: true } } },
      }),
      prisma.profile.count({ where: { enterpriseId: ctx.enterpriseId, createdAt: { gte: addDays(businessDate, -6) } } }),
    ]);

    const natMap = new Map<string, number>();
    let vip = 0;
    for (const r of inHouseGuests) {
      const nat = r.primaryGuest?.nationality?.trim();
      if (nat) natMap.set(nat, (natMap.get(nat) ?? 0) + 1);
      if (r.primaryGuest?.vipLevel) vip += 1;
    }

    // A repeat guest is one whose profile backs more than one stay at this property.
    const repeatUpids = new Set(inHouseGuests.map((r) => r.primaryGuest?.upid).filter((u): u is string => !!u));
    const repeatCount = repeatUpids.size
      ? (
          await prisma.reservation.groupBy({
            by: ["primaryGuestId"],
            where: { propertyId, primaryGuestId: { in: [...repeatUpids] } },
            _count: { _all: true },
          })
        ).filter((g) => g._count._all > 1).length
      : 0;

    out.profiles = {
      inHouseNationalities: [...natMap.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6),
      vipInHouse: vip,
      newProfiles7d: newProfiles,
      repeatGuestPct: repeatUpids.size ? round2((repeatCount / repeatUpids.size) * 100) : null,
    };
  }

  // ── Night Audit posture ─────────────────────────────────────────────────────────
  if (can("NIGHT_AUDIT")) {
    out.visibleSections.push("nightAudit");
    const [activeRun, lastRun] = await Promise.all([
      prisma.eodRun.findFirst({ where: { propertyId, status: "IN_PROGRESS" }, orderBy: { startedAt: "desc" } }),
      prisma.eodRun.findFirst({ where: { propertyId, status: "COMPLETED" }, orderBy: { businessDate: "desc" } }),
    ]);
    const stepFlags = activeRun
      ? [activeRun.departuresAt, activeRun.cashierAt, activeRun.postAt, activeRun.registrationAt, activeRun.reportsAt, activeRun.finalizedAt]
      : [];

    out.nightAudit = {
      businessDate: isoDay(businessDate),
      inProgress: !!activeRun,
      stepsDone: stepFlags.filter(Boolean).length,
      totalSteps: 6,
      lastCompletedAt: lastRun?.completedAt?.toISOString() ?? null,
      lastCompletedBusinessDate: lastRun ? isoDay(lastRun.businessDate) : null,
      // How far the operational day trails real time — the number every GM asks first.
      daysBehind: Math.max(0, Math.round((toUtcMidnight(new Date()).getTime() - businessDate.getTime()) / DAY_MS)),
    };
  }

  // ── Spa (add-on gated) ──────────────────────────────────────────────────────────
  if (canAddOn("SPA")) {
    out.visibleSections.push("spa");
    const appts = await prisma.spaAppointment.findMany({
      where: {
        propertyId,
        appointmentDate: { gte: businessDate, lte: todayEnd },
        appointmentStatus: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
      select: {
        id: true,
        startTime: true,
        treatmentNameSnapshot: true,
        appointmentStatus: true,
        // Guest identity is per-participant and XOR (in-house reservation OR walk-in
        // name) — see SpaAppointmentParticipant. The first participant is the billing
        // anchor, which is the one worth naming on a summary row.
        participants: {
          select: {
            walkInGuestName: true,
            reservation: { select: { primaryGuest: { select: { firstName: true, lastName: true, companyName: true } } } },
          },
          orderBy: { participantIndex: "asc" },
          take: 1,
        },
      },
      orderBy: { startTime: "asc" },
    });
    out.spa = {
      count: appts.length,
      upcoming: appts.slice(0, 5).map((a) => ({
        id: a.id,
        startTime: a.startTime,
        treatment: a.treatmentNameSnapshot,
        guest: a.participants[0]?.reservation?.primaryGuest
          ? guestName(a.participants[0].reservation.primaryGuest)
          : a.participants[0]?.walkInGuestName ?? "Guest",
        status: a.appointmentStatus,
      })),
    };
  }

  // ── Excursions (add-on gated) ───────────────────────────────────────────────────
  if (canAddOn("EXCURSIONS")) {
    out.visibleSections.push("excursions");
    const departures = await prisma.excursionDeparture.findMany({
      where: {
        excursionType: { propertyId },
        departureDate: { gte: businessDate, lte: todayEnd },
        status: { not: "CANCELLED" },
      },
      select: {
        id: true,
        departureTime: true,
        capacity: true,
        status: true,
        excursionType: { select: { name: true } },
        bookings: { where: { status: { in: ["CONFIRMED", "COMPLETED"] } }, select: { id: true } },
      },
      orderBy: { departureTime: "asc" },
    });
    out.excursions = {
      count: departures.length,
      departures: departures.slice(0, 5).map((d) => ({
        id: d.id,
        time: d.departureTime,
        name: d.excursionType.name,
        booked: d.bookings.length,
        capacity: d.capacity,
        status: d.status,
      })),
    };
  }

  // ── Outlet sales (Fast Post) ────────────────────────────────────────────────────
  if (can("POS")) {
    out.visibleSections.push("pos");
    const [checks, outletLines] = await Promise.all([
      prisma.outletCheck.count({ where: { propertyId, createdAt: { gte: businessDate, lte: todayEnd } } }),
      prisma.folioLineItem.findMany({
        where: { folio: { propertyId }, isVoid: false, outletId: { not: null }, date: { gte: businessDate, lte: todayEnd } },
        select: { amount: true, taxAmount: true, serviceChargeAmount: true, outlet: { select: { name: true } } },
      }),
    ]);
    const outletMap = new Map<string, number>();
    for (const l of outletLines) {
      const name = l.outlet?.name ?? "Unassigned";
      outletMap.set(name, (outletMap.get(name) ?? 0) + lineTotal(l));
    }
    out.pos = {
      checksToday: checks,
      salesToday: round2(sumMoney(outletLines.map(lineTotal))),
      byOutlet: [...outletMap.entries()]
        .map(([name, amount]) => ({ name, amount: round2(amount) }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 6),
    };
  }

  // ── Channel connectivity (Hub module — enterprise-scoped users only) ────────────
  if (hasHubAccess(ctx) && can("INTEGRATIONS")) {
    out.visibleSections.push("integrations");
    const dayAgo = new Date(Date.now() - DAY_MS);
    const [connections, activeConnections, pendingInbound, failedInbound, syncErrors24h, lastOk] = await Promise.all([
      prisma.channelConnection.count({ where: { enterpriseId: ctx.enterpriseId } }),
      prisma.channelConnection.count({ where: { enterpriseId: ctx.enterpriseId, status: CONNECTION_STATUS.CONNECTED } }),
      prisma.channelInboundBooking.count({ where: { enterpriseId: ctx.enterpriseId, status: "RECEIVED" } }),
      prisma.channelInboundBooking.count({ where: { enterpriseId: ctx.enterpriseId, status: "FAILED" } }),
      prisma.channelSyncLog.count({ where: { enterpriseId: ctx.enterpriseId, ok: false, createdAt: { gte: dayAgo } } }),
      prisma.channelSyncLog.findFirst({
        where: { enterpriseId: ctx.enterpriseId, ok: true },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);
    out.integrations = {
      connections,
      activeConnections,
      pendingInbound,
      failedInbound,
      syncErrors24h,
      lastSyncAt: lastOk?.createdAt.toISOString() ?? null,
    };
  }

  // ── Activity feed ───────────────────────────────────────────────────────────────
  if (can("ACTIVITY_LOG")) {
    out.visibleSections.push("activity");
    const entries = await prisma.userActivityLog.findMany({
      where: { enterpriseId: ctx.enterpriseId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, createdAt: true, userName: true, userEmail: true, module: true, action: true, description: true },
    });
    out.activity = entries.map((e) => ({
      id: e.id,
      at: e.createdAt.toISOString(),
      user: e.userName ?? e.userEmail ?? "System",
      module: e.module,
      action: e.action,
      description: e.description,
    }));
  }

  // ── Front-desk worklists ────────────────────────────────────────────────────────
  if (showOccupancy) {
    out.visibleSections.push("worklists");
    const rowSelect = {
      id: true,
      confirmationNo: true,
      checkInDate: true,
      checkOutDate: true,
      primaryGuest: { select: { firstName: true, lastName: true, companyName: true, vipLevel: true } },
      assignments: { select: { room: { select: { roomNumber: true } }, roomType: { select: { name: true } } }, take: 1 },
      folios: {
        select: {
          lineItems: { select: { amount: true, taxAmount: true, serviceChargeAmount: true, isVoid: true } },
          payments: { select: { amount: true, isRefund: true } },
        },
      },
    } as const;

    const [arrivalRows, departureRows, alertRows] = await Promise.all([
      prisma.reservation.findMany({
        where: { propertyId, status: ReservationStatus.RESERVED, checkInDate: { gte: businessDate, lte: todayEnd } },
        select: rowSelect,
        orderBy: { confirmationNo: "asc" },
        take: 6,
      }),
      prisma.reservation.findMany({
        where: { propertyId, status: ReservationStatus.IN_HOUSE, checkOutDate: { gte: businessDate, lte: todayEnd } },
        select: rowSelect,
        orderBy: { confirmationNo: "asc" },
        take: 6,
      }),
      prisma.reservationTrace.findMany({
        where: { isResolved: false, reservation: { propertyId, status: { in: [ReservationStatus.RESERVED, ReservationStatus.IN_HOUSE] } } },
        orderBy: [{ alertOnOpen: "desc" }, { createdAt: "desc" }],
        take: 6,
        select: {
          id: true,
          traceType: true,
          description: true,
          reservation: {
            select: { id: true, confirmationNo: true, primaryGuest: { select: { firstName: true, lastName: true, companyName: true } } },
          },
        },
      }),
    ]);

    const toRow = (r: (typeof arrivalRows)[number]): OverviewWorklistRow => ({
      id: r.id,
      confirmationNo: r.confirmationNo,
      guestName: guestName(r.primaryGuest),
      roomNumber: r.assignments[0]?.room?.roomNumber ?? null,
      roomTypeName: r.assignments[0]?.roomType?.name ?? null,
      nights: Math.max(1, Math.round((toUtcMidnight(r.checkOutDate).getTime() - toUtcMidnight(r.checkInDate).getTime()) / DAY_MS)),
      balance: round2(sumMoney(r.folios.map((f) => computeFolioBalance(f.lineItems, f.payments)))),
      flag: r.primaryGuest?.vipLevel ?? null,
    });

    out.worklists = {
      arrivals: arrivalRows.map(toRow),
      departures: departureRows.map(toRow),
      alerts: alertRows.map((t) => ({
        id: t.id,
        reservationId: t.reservation.id,
        confirmationNo: t.reservation.confirmationNo,
        guestName: guestName(t.reservation.primaryGuest),
        traceType: t.traceType,
        description: t.description,
      })),
    };
  }

  return out;
}
