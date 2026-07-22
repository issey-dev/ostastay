import { prisma } from "@/lib/db";
import { rangeBounds } from "@/lib/reports/params";
import { guestName, propertyOrThrow } from "@/lib/reports/defs/_shared";
import type { ReportDef, ReportResult, ReportGroup } from "@/lib/reports/types";

const fmtDay = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const overlapNights = (ci: Date, co: Date, from: Date, toExcl: Date): number => {
  const start = Math.max(ci.getTime(), from.getTime());
  const end = Math.min(co.getTime(), toExcl.getTime());
  return Math.max(0, Math.round((end - start) / 86_400_000));
};

async function sellableRoomCount(propertyId: string): Promise<number> {
  return prisma.room.count({ where: { propertyId, roomType: { isPseudo: false }, status: { notIn: ["OUT_OF_ORDER", "OUT_OF_SERVICE"] } } });
}

// ─── History & Forecast ─────────────────────────────────────────────────────
const historyForecast: ReportDef = {
  key: "rev-history-forecast",
  module: "REVENUE",
  name: "History & Forecast",
  description: "Occupancy, room revenue and ADR — actuals from Night Audit, projections from the books.",
  params: [{ key: "range", label: "Date range", type: "dateRange", required: true, defaultToday: true }],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const range = rc.params.range as { from: Date; to: Date };
    const { gte, lt } = rangeBounds(range.from, range.to);
    const totalRooms = await sellableRoomCount(propertyId);

    // Actuals: nightly audit snapshots keyed by date.
    const logs = await prisma.propertyNightAuditLog.findMany({ where: { propertyId, auditDate: { gte, lt } } });
    const logByDay = new Map(logs.map((l) => [l.auditDate.getTime(), l]));

    // For forecast nights, project from on-the-books reservations.
    const assignments = await prisma.roomAssignment.findMany({
      where: { startDate: { lt }, endDate: { gt: gte }, reservation: { propertyId, status: { in: ["RESERVED", "IN_HOUSE"] } } },
      select: { startDate: true, endDate: true, overrideRate: true },
    });

    const actual: Record<string, unknown>[] = [];
    const forecast: Record<string, unknown>[] = [];
    for (let t = gte.getTime(); t < lt.getTime(); t += 86_400_000) {
      const d = new Date(t);
      const log = logByDay.get(t);
      if (log) {
        actual.push({
          date: d, occupied: log.roomsOccupied,
          occPct: totalRooms ? round2((log.roomsOccupied / totalRooms) * 100) : 0,
          revenue: round2(log.roomRevenue),
          adr: log.roomsOccupied ? round2(log.roomRevenue / log.roomsOccupied) : 0,
        });
      } else {
        const occ = assignments.filter((a) => a.startDate <= d && a.endDate > d);
        const rev = occ.reduce((s, a) => s + (a.overrideRate ?? 0), 0);
        forecast.push({
          date: d, occupied: occ.length,
          occPct: totalRooms ? round2((occ.length / totalRooms) * 100) : 0,
          revenue: round2(rev),
          adr: occ.length ? round2(rev / occ.length) : 0,
        });
      }
    }

    const groups: ReportGroup[] = [];
    const columns = [
      { key: "date", label: "Date", width: 1.3, format: "date" as const },
      { key: "occupied", label: "Occupied", width: 0.8, format: "number" as const },
      { key: "occPct", label: "Occ %", width: 0.7, format: "number" as const },
      { key: "revenue", label: "Room Revenue", width: 1, format: "currency" as const },
      { key: "adr", label: "ADR", width: 0.9, format: "currency" as const },
    ];
    const subtotal = (rows: Record<string, unknown>[]) => {
      const rev = rows.reduce((s, r) => s + (r.revenue as number), 0);
      const occ = rows.reduce((s, r) => s + (r.occupied as number), 0);
      return { revenue: round2(rev), occupied: occ, adr: occ ? round2(rev / occ) : 0 };
    };
    if (actual.length) groups.push({ label: `Actual (${totalRooms} sellable rooms)`, rows: actual, subtotals: subtotal(actual) });
    if (forecast.length) groups.push({ label: "Forecast (on the books)", rows: forecast, subtotals: subtotal(forecast) });

    return {
      title: "History & Forecast",
      subtitle: `${fmtDay(gte)} – ${fmtDay(new Date(lt.getTime() - 86_400_000))}`,
      note: "Actual rows come from Night Audit snapshots; forecast rows project on-the-books room revenue.",
      columns,
      groups,
    };
  },
};

// ─── Nationality Statistics ─────────────────────────────────────────────────
const nationality: ReportDef = {
  key: "rev-nationality",
  module: "REVENUE",
  name: "Nationality Statistics",
  description: "Guest nationalities of stays overlapping the period, by room nights and guests.",
  params: [{ key: "range", label: "Stay period", type: "dateRange", required: true, defaultToday: true }],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const range = rc.params.range as { from: Date; to: Date };
    const { gte, lt } = rangeBounds(range.from, range.to);

    const reservations = await prisma.reservation.findMany({
      where: { propertyId, status: { in: ["RESERVED", "IN_HOUSE", "CHECKED_OUT"] }, checkInDate: { lt }, checkOutDate: { gt: gte } },
      select: { checkInDate: true, checkOutDate: true, adults: true, children: true, primaryGuest: { select: { nationality: true } } },
    });
    const codes = await prisma.systemCode.findMany({ where: { enterpriseId: rc.ctx.enterpriseId, category: "NATIONALITY" }, select: { code: true, value: true } });
    const label = new Map(codes.map((c) => [c.code, c.value]));

    const byNat = new Map<string, { nationality: string; reservations: number; guests: number; roomNights: number }>();
    for (const r of reservations) {
      const key = r.primaryGuest?.nationality || "—";
      const row = byNat.get(key) ?? { nationality: label.get(key) ?? key, reservations: 0, guests: 0, roomNights: 0 };
      row.reservations += 1;
      row.guests += r.adults + r.children;
      row.roomNights += overlapNights(r.checkInDate, r.checkOutDate, gte, lt);
      byNat.set(key, row);
    }
    const rows = Array.from(byNat.values()).sort((a, b) => b.roomNights - a.roomNights);
    return {
      title: "Nationality Statistics",
      subtitle: `Stays overlapping ${fmtDay(gte)} – ${fmtDay(new Date(lt.getTime() - 86_400_000))}`,
      columns: [
        { key: "nationality", label: "Nationality", width: 2 },
        { key: "reservations", label: "Reservations", width: 1, format: "number" },
        { key: "guests", label: "Guests", width: 0.8, format: "number" },
        { key: "roomNights", label: "Room Nights", width: 1, format: "number" },
      ],
      rows,
      totals: {
        reservations: rows.reduce((s, r) => s + r.reservations, 0),
        guests: rows.reduce((s, r) => s + r.guests, 0),
        roomNights: rows.reduce((s, r) => s + r.roomNights, 0),
      },
    };
  },
};

// ─── Profile Production (Travel Agent & Corporate) ──────────────────────────
const production: ReportDef = {
  key: "rev-profile-production",
  module: "REVENUE",
  name: "Profile Production (TA & Corporate)",
  description: "Room nights, room revenue and commission produced by each travel agent / company.",
  params: [{ key: "range", label: "Arrival between", type: "dateRange", required: true, defaultToday: true }],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const range = rc.params.range as { from: Date; to: Date };
    const { gte, lt } = rangeBounds(range.from, range.to);
    const settings = await prisma.enterpriseSettings.findUnique({ where: { enterpriseId: rc.ctx.enterpriseId }, select: { commissionChargeCodeId: true } });

    const reservations = await prisma.reservation.findMany({
      where: { propertyId, travelAgentId: { not: null }, checkInDate: { gte, lt } },
      include: {
        travelAgent: { select: { firstName: true, lastName: true, companyName: true, profileType: true } },
        folios: { include: { lineItems: { include: { chargeCode: { select: { category: true, id: true } } } } } },
      },
    });

    const byAgent = new Map<string, { agent: string; type: string; reservations: number; roomNights: number; roomRevenue: number; commission: number }>();
    for (const r of reservations) {
      const key = r.travelAgentId!;
      const row = byAgent.get(key) ?? {
        agent: guestName(r.travelAgent),
        type: r.travelAgent?.profileType === "COMPANY" ? "Corporate" : "Travel Agent",
        reservations: 0, roomNights: 0, roomRevenue: 0, commission: 0,
      };
      row.reservations += 1;
      row.roomNights += Math.max(0, Math.round((r.checkOutDate.getTime() - r.checkInDate.getTime()) / 86_400_000));
      for (const f of r.folios) {
        for (const li of f.lineItems) {
          if (li.isVoid) continue;
          if (li.chargeCode?.category === "ROOM") row.roomRevenue += li.amount + li.taxAmount + (li.serviceChargeAmount || 0);
          if (settings?.commissionChargeCodeId && li.chargeCode?.id === settings.commissionChargeCodeId) row.commission += Math.abs(li.amount);
        }
      }
      byAgent.set(key, row);
    }
    const rows = Array.from(byAgent.values())
      .map((r) => ({ ...r, roomRevenue: round2(r.roomRevenue), commission: round2(r.commission) }))
      .sort((a, b) => b.roomRevenue - a.roomRevenue);
    return {
      title: "Profile Production (TA & Corporate)",
      subtitle: `Arrivals ${fmtDay(gte)} – ${fmtDay(new Date(lt.getTime() - 86_400_000))}`,
      columns: [
        { key: "agent", label: "Agent / Company", width: 2 },
        { key: "type", label: "Type", width: 1 },
        { key: "reservations", label: "Res", width: 0.6, format: "number" },
        { key: "roomNights", label: "Room Nts", width: 0.8, format: "number" },
        { key: "roomRevenue", label: "Room Revenue", width: 1.1, format: "currency" },
        { key: "commission", label: "Commission", width: 1, format: "currency" },
      ],
      rows,
      totals: {
        reservations: rows.reduce((s, r) => s + r.reservations, 0),
        roomNights: rows.reduce((s, r) => s + r.roomNights, 0),
        roomRevenue: round2(rows.reduce((s, r) => s + r.roomRevenue, 0)),
        commission: round2(rows.reduce((s, r) => s + r.commission, 0)),
      },
    };
  },
};

export const REVENUE_REPORTS: ReportDef[] = [historyForecast, nationality, production];
