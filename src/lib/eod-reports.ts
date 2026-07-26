import { prisma } from "@/lib/db";
import { toUtcMidnight } from "@/lib/business-date";
import { summarizeShiftPayments, type MethodBreakdownRow } from "@/lib/shift-summary";

// The six End-of-Day reports, snapshotted per business date during the reports
// step (see src/app/api/eod/step/route.ts). Each is stored as a JSON blob on
// EodReport so a closed date's figures are frozen and never recomputed.
//
// Date semantics — two different kinds of figure live in these reports:
//   • FLOW figures (the day's postings and collections). Charges are stamped with
//     the business date (FolioLineItem.date), so they filter on [D, D+1). Payments
//     are anchored via their cashier shift, which carries the property + business
//     date it was opened under — so collections are exactly the day's, per property,
//     even if wall-clock time has drifted from the business date.
//   • POSITION figures (ledger balances) are the live folio state at snapshot
//     time, which is exactly "as of the close" of date D.

export const EOD_REPORT_TYPES = [
  "TRIAL_BALANCE",
  "GUEST_LEDGER",
  "AR_LEDGER",
  "DEPOSIT_LEDGER",
  "CASHIER_SUMMARY",
  "MANAGER_FLASH",
] as const;
export type EodReportType = (typeof EOD_REPORT_TYPES)[number];

export const EOD_REPORT_LABELS: Record<EodReportType, string> = {
  TRIAL_BALANCE: "Trial Balance",
  GUEST_LEDGER: "Guest Ledger",
  AR_LEDGER: "AR Ledger",
  DEPOSIT_LEDGER: "Deposit Ledger",
  CASHIER_SUMMARY: "Cashier Summary",
  MANAGER_FLASH: "Manager Flash",
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

type LineItem = { amount: number; taxAmount: number; serviceChargeAmount: number; isVoid: boolean };
type Pay = { amount: number; isRefund: boolean };

function chargeTotal(items: LineItem[]): number {
  return items.reduce((s, i) => (i.isVoid ? s : s + i.amount + i.taxAmount + (i.serviceChargeAmount || 0)), 0);
}
function paymentsNet(pays: Pay[]): number {
  return pays.reduce((s, p) => s + (p.isRefund ? -p.amount : p.amount), 0);
}

function guestName(res: { primaryGuest?: { firstName: string; lastName: string | null } | null } | null, fallback?: string | null): string {
  if (res?.primaryGuest) return [res.primaryGuest.firstName, res.primaryGuest.lastName].filter(Boolean).join(" ");
  return fallback || "Walk-in / Unknown";
}

// A property's folios with everything the six reports read, loaded once.
async function loadFolios(propertyId: string) {
  return prisma.folio.findMany({
    where: { propertyId },
    include: {
      lineItems: { include: { chargeCode: { select: { category: true, description: true } } } },
      payments: true,
      payeeProfile: { select: { firstName: true, lastName: true } },
      reservation: {
        select: {
          confirmationNo: true,
          status: true,
          checkInDate: true,
          checkOutDate: true,
          primaryGuest: { select: { firstName: true, lastName: true } },
          assignments: { select: { room: { select: { roomNumber: true } } } },
        },
      },
    },
  });
}

// ─── The generators ─────────────────────────────────────────────────────────

export async function generateEodReports(propertyId: string, businessDate: Date) {
  const day = toUtcMidnight(businessDate);
  const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000);
  const meta = { businessDate: day.toISOString(), generatedAt: new Date().toISOString() };

  const folios = await loadFolios(propertyId);

  // Room-number label for a folio (first assigned room, else walk-in tag).
  const roomOf = (f: (typeof folios)[number]) =>
    f.reservation?.assignments?.map((a) => a.room?.roomNumber).filter(Boolean).join(", ") || (f.reservation ? "—" : "Walk-in");

  // ── Guest Ledger: open, in-house, non-debtor folios ──
  const guestRows = folios
    .filter((f) => f.reservation?.status === "IN_HOUSE" && !f.isDebtorAccount && !f.isClosed)
    .map((f) => {
      const charges = chargeTotal(f.lineItems);
      const payments = paymentsNet(f.payments);
      return {
        folioId: f.id,
        confirmationNo: f.reservation?.confirmationNo ?? null,
        guest: guestName(f.reservation, f.walkInGuestName),
        room: roomOf(f),
        charges: round2(charges),
        payments: round2(payments),
        balance: round2(charges - payments),
      };
    })
    .sort((a, b) => (a.room > b.room ? 1 : -1));
  const guestLedger = {
    ...meta,
    rows: guestRows,
    totals: {
      charges: round2(guestRows.reduce((s, r) => s + r.charges, 0)),
      payments: round2(guestRows.reduce((s, r) => s + r.payments, 0)),
      balance: round2(guestRows.reduce((s, r) => s + r.balance, 0)),
    },
  };

  // ── AR Ledger: finalized debtor invoices with an outstanding balance ──
  const arRows = folios
    .filter((f) => f.isDebtorAccount)
    .map((f) => {
      const charges = chargeTotal(f.lineItems);
      const payments = paymentsNet(f.payments);
      const account = f.payeeProfile ? [f.payeeProfile.firstName, f.payeeProfile.lastName].filter(Boolean).join(" ") : "—";
      return {
        folioId: f.id,
        confirmationNo: f.reservation?.confirmationNo ?? null,
        account,
        guest: guestName(f.reservation, f.walkInGuestName),
        charges: round2(charges),
        payments: round2(payments),
        balance: round2(charges - payments),
      };
    })
    .filter((r) => Math.abs(r.balance) > 0.005)
    .sort((a, b) => b.balance - a.balance);
  const arLedger = {
    ...meta,
    rows: arRows,
    totals: {
      charges: round2(arRows.reduce((s, r) => s + r.charges, 0)),
      payments: round2(arRows.reduce((s, r) => s + r.payments, 0)),
      balance: round2(arRows.reduce((s, r) => s + r.balance, 0)),
    },
  };

  // ── Deposit Ledger: money collected on not-yet-arrived reservations ──
  const depositRows = folios
    .filter((f) => (f.reservation?.status === "RESERVED" || f.reservation?.status === "CONFIRMED") && paymentsNet(f.payments) !== 0)
    .map((f) => {
      const charges = chargeTotal(f.lineItems);
      const deposit = paymentsNet(f.payments);
      return {
        folioId: f.id,
        confirmationNo: f.reservation?.confirmationNo ?? null,
        guest: guestName(f.reservation, f.walkInGuestName),
        arrivalDate: f.reservation?.checkInDate?.toISOString() ?? null,
        deposit: round2(deposit),
        charges: round2(charges),
        // Positive = credit the guest is holding against their arrival.
        creditHeld: round2(deposit - charges),
      };
    })
    .sort((a, b) => (a.arrivalDate ?? "").localeCompare(b.arrivalDate ?? ""));
  const depositLedger = {
    ...meta,
    rows: depositRows,
    totals: {
      deposit: round2(depositRows.reduce((s, r) => s + r.deposit, 0)),
      charges: round2(depositRows.reduce((s, r) => s + r.charges, 0)),
      creditHeld: round2(depositRows.reduce((s, r) => s + r.creditHeld, 0)),
    },
  };

  // ── The day's charge postings, grouped by charge-code category (business-date stamped) ──
  type CatRow = { category: string; count: number; amount: number; tax: number; serviceCharge: number; total: number };
  const catMap = new Map<string, CatRow>();
  let dayRoomRevenue = 0;
  for (const f of folios) {
    for (const li of f.lineItems) {
      if (li.isVoid) continue;
      if (li.date < day || li.date >= dayEnd) continue;
      const category = li.chargeCode?.category ?? "OTHERS";
      const row = catMap.get(category) ?? { category, count: 0, amount: 0, tax: 0, serviceCharge: 0, total: 0 };
      row.count += 1;
      row.amount += li.amount;
      row.tax += li.taxAmount;
      row.serviceCharge += li.serviceChargeAmount || 0;
      row.total += li.amount + li.taxAmount + (li.serviceChargeAmount || 0);
      catMap.set(category, row);
      if (category === "ROOM") dayRoomRevenue += li.amount + li.taxAmount + (li.serviceChargeAmount || 0);
    }
  }
  const chargeCategories = Array.from(catMap.values())
    .map((r) => ({ ...r, amount: round2(r.amount), tax: round2(r.tax), serviceCharge: round2(r.serviceCharge), total: round2(r.total) }))
    .sort((a, b) => b.total - a.total);
  const chargesTotal = round2(chargeCategories.reduce((s, r) => s + r.total, 0));

  // ── The day's payments, for Cashier Summary + Trial Balance credits ──
  // Anchored on the cashier shifts belonging to this (property, business date): a
  // payment carries a shift, and a shift is stamped with the property + business
  // date it was opened under, so this captures exactly the day's collections
  // regardless of wall-clock drift.
  const dayPayments = await prisma.payment.findMany({
    where: { shift: { propertyId, businessDate: day } },
    include: { paymentMethod: { select: { name: true, type: true } }, shift: { select: { userId: true } } },
  });
  const shiftUserIds = Array.from(new Set(dayPayments.map((p) => p.shift?.userId).filter(Boolean))) as string[];
  const users = shiftUserIds.length
    ? await prisma.user.findMany({ where: { id: { in: shiftUserIds } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const userName = new Map(users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(" ")]));

  // Cashier Summary: group by cashier (shift user), then payment method.
  const byUser = new Map<string, { userId: string; user: string; payments: typeof dayPayments }>();
  for (const p of dayPayments) {
    const uid = p.shift?.userId ?? "unassigned";
    const bucket = byUser.get(uid) ?? { userId: uid, user: userName.get(uid) ?? "Unassigned", payments: [] as typeof dayPayments };
    bucket.payments.push(p);
    byUser.set(uid, bucket);
  }
  const cashierRows = Array.from(byUser.values()).map((b) => {
    const s = summarizeShiftPayments(b.payments);
    return {
      userId: b.userId,
      user: b.user,
      byMethod: s.byMethod.map((m: MethodBreakdownRow) => ({ ...m, received: round2(m.received), refunded: round2(m.refunded), net: round2(m.net) })),
      received: round2(s.byMethod.reduce((x, m) => x + m.received, 0)),
      refunded: round2(s.byMethod.reduce((x, m) => x + m.refunded, 0)),
      net: round2(s.byMethod.reduce((x, m) => x + m.net, 0)),
    };
  }).sort((a, b) => b.net - a.net);
  const paymentsTotal = round2(cashierRows.reduce((s, r) => s + r.net, 0));
  const cashierSummary = {
    ...meta,
    rows: cashierRows,
    totals: {
      received: round2(cashierRows.reduce((s, r) => s + r.received, 0)),
      refunded: round2(cashierRows.reduce((s, r) => s + r.refunded, 0)),
      net: paymentsTotal,
    },
  };

  // ── Trial Balance: the day's debits (charges) and credits (payments) plus the
  //    closing ledger positions the movements roll into. ──
  const trialBalance = {
    ...meta,
    charges: { byCategory: chargeCategories, total: chargesTotal },
    payments: {
      byMethod: cashierRows
        .flatMap((r) => r.byMethod)
        .reduce((acc: MethodBreakdownRow[], m) => {
          const found = acc.find((x) => x.method === m.method);
          if (found) { found.received += m.received; found.refunded += m.refunded; found.net += m.net; }
          else acc.push({ ...m });
          return acc;
        }, [])
        .map((m) => ({ ...m, received: round2(m.received), refunded: round2(m.refunded), net: round2(m.net) })),
      total: paymentsTotal,
    },
    ledgers: {
      guestLedger: guestLedger.totals.balance,
      arLedger: arLedger.totals.balance,
      depositLedger: depositLedger.totals.creditHeld,
    },
    totals: { debits: chargesTotal, credits: paymentsTotal },
  };

  // ── Manager Flash: occupancy + revenue + activity for the night of date D ──
  // Sellable rooms = active rooms of a non-pseudo room type.
  const sellableRooms = await prisma.room.count({ where: { propertyId, roomType: { isPseudo: false } } });
  // Occupied night D = in-house reservation spanning the night (checkInDate ≤ D < checkOutDate),
  // excluding pseudo/day-use room types.
  const occReservations = await prisma.reservation.count({
    where: {
      propertyId,
      status: "IN_HOUSE",
      checkInDate: { lte: day },
      checkOutDate: { gt: day },
      assignments: { some: { roomType: { isPseudo: false } } },
    },
  });
  const [arrivals, departures, noShows] = await Promise.all([
    prisma.reservation.count({ where: { propertyId, checkInDate: day, status: { in: ["IN_HOUSE", "CHECKED_OUT"] } } }),
    prisma.reservation.count({ where: { propertyId, checkOutDate: day, status: "CHECKED_OUT" } }),
    prisma.reservation.count({ where: { propertyId, checkInDate: day, status: "NO_SHOW" } }),
  ]);
  const roomRevenue = round2(dayRoomRevenue);
  const otherRevenue = round2(chargesTotal - roomRevenue);
  const managerFlash = {
    ...meta,
    occupancy: {
      roomsAvailable: sellableRooms,
      roomsOccupied: occReservations,
      occupancyPct: sellableRooms ? round2((occReservations / sellableRooms) * 100) : 0,
      adr: occReservations ? round2(roomRevenue / occReservations) : 0,
      revPar: sellableRooms ? round2(roomRevenue / sellableRooms) : 0,
    },
    revenue: { byCategory: chargeCategories.map((c) => ({ category: c.category, total: c.total })), roomRevenue, otherRevenue, total: chargesTotal },
    activity: { arrivals, departures, noShows, inHouse: occReservations },
  };

  return {
    TRIAL_BALANCE: trialBalance,
    GUEST_LEDGER: guestLedger,
    AR_LEDGER: arLedger,
    DEPOSIT_LEDGER: depositLedger,
    CASHIER_SUMMARY: cashierSummary,
    MANAGER_FLASH: managerFlash,
  } satisfies Record<EodReportType, unknown>;
}

// Generate all six reports and freeze them as EodReport rows for the date.
// Idempotent — re-running overwrites the snapshot with a fresh computation
// (the reports step guard normally prevents that, but a manual regenerate is safe).
export async function snapshotEodReports(propertyId: string, businessDate: Date) {
  const day = toUtcMidnight(businessDate);
  const reports = await generateEodReports(propertyId, day);
  for (const reportType of EOD_REPORT_TYPES) {
    const data = JSON.stringify(reports[reportType]);
    await prisma.eodReport.upsert({
      where: { propertyId_businessDate_reportType: { propertyId, businessDate: day, reportType } },
      update: { data, generatedAt: new Date() },
      create: { propertyId, businessDate: day, reportType, data },
    });
  }
  return reports;
}
