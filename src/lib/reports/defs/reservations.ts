import { prisma } from "@/lib/db";
import { computeFolioBalance } from "@/lib/debtor-accounts";
import { rangeBounds } from "@/lib/reports/params";
import { guestName, nights, primaryRoom, propertyOrThrow, guestSelect, assignmentInclude, titleCase } from "@/lib/reports/defs/_shared";
import type { ReportDef, ReportResult, ReportGroup } from "@/lib/reports/types";

const fmtDay = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });

// ─── Availability ───────────────────────────────────────────────────────────
const availability: ReportDef = {
  key: "res-availability",
  module: "RESERVATIONS",
  name: "Availability",
  description: "Rooms sold vs. available by room type across the selected date range.",
  params: [
    { key: "range", label: "Date range", type: "dateRange", required: true, defaultToday: true },
    { key: "roomTypeIds", label: "Room types", type: "multiSelect", optionSource: "roomTypes" },
  ],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const range = rc.params.range as { from: Date; to: Date };
    const { gte, lt } = rangeBounds(range.from, range.to);
    const roomTypeIds = (rc.params.roomTypeIds as string[]) ?? [];

    const roomTypes = await prisma.roomType.findMany({
      where: { propertyId, isPseudo: false, isActive: true, ...(roomTypeIds.length ? { id: { in: roomTypeIds } } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    // Sellable rooms per type (exclude out-of-order / out-of-service).
    const rooms = await prisma.room.findMany({
      where: { propertyId, roomTypeId: { in: roomTypes.map((t) => t.id) }, status: { notIn: ["OUT_OF_ORDER", "OUT_OF_SERVICE"] } },
      select: { roomTypeId: true },
    });
    const totalByType = new Map<string, number>();
    for (const r of rooms) totalByType.set(r.roomTypeId, (totalByType.get(r.roomTypeId) ?? 0) + 1);

    // Assignments that occupy any night in the window (confirmed/in-house/departed).
    const assignments = await prisma.roomAssignment.findMany({
      where: {
        roomTypeId: { in: roomTypes.map((t) => t.id) },
        startDate: { lt },
        endDate: { gt: gte },
        reservation: { propertyId, status: { in: ["RESERVED", "IN_HOUSE", "CHECKED_OUT"] } },
      },
      select: { roomTypeId: true, startDate: true, endDate: true },
    });

    // Each night in the window.
    const nightsList: Date[] = [];
    for (let t = gte.getTime(); t < lt.getTime(); t += 86_400_000) nightsList.push(new Date(t));

    const groups: ReportGroup[] = roomTypes.map((rt) => {
      const total = totalByType.get(rt.id) ?? 0;
      const rows = nightsList.map((d) => {
        const sold = assignments.filter((a) => a.roomTypeId === rt.id && a.startDate <= d && a.endDate > d).length;
        const available = total - sold;
        return {
          date: d,
          total,
          sold,
          available,
          occPct: total ? Math.round((sold / total) * 1000) / 10 : 0,
        };
      });
      return { label: `${rt.name} — ${total} room(s)`, rows };
    });

    return {
      title: "Availability",
      subtitle: `${fmtDay(gte)} – ${fmtDay(new Date(lt.getTime() - 86_400_000))}`,
      columns: [
        { key: "date", label: "Date", width: 1.4, format: "date" },
        { key: "total", label: "Total", width: 0.7, format: "number" },
        { key: "sold", label: "Sold", width: 0.7, format: "number" },
        { key: "available", label: "Available", width: 0.9, format: "number" },
        { key: "occPct", label: "Occ %", width: 0.7, format: "number" },
      ],
      groups,
    };
  },
};

// ─── Reservations Entered ───────────────────────────────────────────────────
const entered: ReportDef = {
  key: "res-entered",
  module: "RESERVATIONS",
  name: "Reservations Entered",
  description: "Reservations created (booked) within the selected date range.",
  params: [{ key: "range", label: "Entered between", type: "dateRange", required: true, defaultToday: true }],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const range = rc.params.range as { from: Date; to: Date };
    const { gte, lt } = rangeBounds(range.from, range.to);
    const reservations = await prisma.reservation.findMany({
      where: { propertyId, createdAt: { gte, lt } },
      include: { primaryGuest: guestSelect, assignments: assignmentInclude },
      orderBy: { createdAt: "asc" },
    });
    return {
      title: "Reservations Entered",
      subtitle: `Booked ${fmtDay(gte)} – ${fmtDay(new Date(lt.getTime() - 86_400_000))} — ${reservations.length} reservation(s)`,
      columns: [
        { key: "entered", label: "Entered", width: 1.3, format: "datetime" },
        { key: "conf", label: "Confirmation", width: 1.2 },
        { key: "guest", label: "Guest", width: 1.7 },
        { key: "roomType", label: "Room Type", width: 1.1 },
        { key: "arrival", label: "Arrival", width: 1, format: "date" },
        { key: "departure", label: "Departure", width: 1, format: "date" },
        { key: "nights", label: "Nts", width: 0.5, format: "number" },
        { key: "status", label: "Status", width: 1 },
      ],
      rows: reservations.map((r) => ({
        entered: r.createdAt,
        conf: r.confirmationNo,
        guest: guestName(r.primaryGuest),
        roomType: r.assignments[0]?.roomType?.name ?? "—",
        arrival: r.checkInDate,
        departure: r.checkOutDate,
        nights: nights(r.checkInDate, r.checkOutDate),
        status: titleCase(r.status),
      })),
    };
  },
};

// ─── Cancellations & No-Shows ───────────────────────────────────────────────
const cancellations: ReportDef = {
  key: "res-cancellations",
  module: "RESERVATIONS",
  name: "Cancellations & No-Shows",
  description: "Reservations cancelled or marked no-show within the selected date range.",
  params: [
    { key: "range", label: "Date range", type: "dateRange", required: true, defaultToday: true },
    { key: "kinds", label: "Include", type: "multiSelect", options: [ { label: "Cancellations", value: "CANCELLED" }, { label: "No-Shows", value: "NO_SHOW" } ] },
  ],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const range = rc.params.range as { from: Date; to: Date };
    const { gte, lt } = rangeBounds(range.from, range.to);
    const kinds = (rc.params.kinds as string[]) ?? [];
    const wantCancel = kinds.length === 0 || kinds.includes("CANCELLED");
    const wantNoShow = kinds.length === 0 || kinds.includes("NO_SHOW");

    const or: object[] = [];
    if (wantCancel) or.push({ cancelledAt: { gte, lt } });
    if (wantNoShow) or.push({ noShowAt: { gte, lt } });

    const reservations = await prisma.reservation.findMany({
      where: { propertyId, OR: or },
      include: { primaryGuest: guestSelect, assignments: assignmentInclude },
    });
    const rows = reservations.map((r) => {
      const isNoShow = !!r.noShowAt && (!r.cancelledAt || r.noShowAt >= r.cancelledAt);
      return {
        date: isNoShow ? r.noShowAt : r.cancelledAt,
        kind: isNoShow ? "No-Show" : "Cancelled",
        conf: r.confirmationNo,
        guest: guestName(r.primaryGuest),
        arrival: r.checkInDate,
        reason: r.cancellationReason ?? "",
        _t: (isNoShow ? r.noShowAt : r.cancelledAt)?.getTime() ?? 0,
      };
    }).sort((a, b) => a._t - b._t);

    return {
      title: "Cancellations & No-Shows",
      subtitle: `${fmtDay(gte)} – ${fmtDay(new Date(lt.getTime() - 86_400_000))} — ${rows.length} record(s)`,
      columns: [
        { key: "date", label: "Date", width: 1, format: "date" },
        { key: "kind", label: "Type", width: 0.9 },
        { key: "conf", label: "Confirmation", width: 1.2 },
        { key: "guest", label: "Guest", width: 1.7 },
        { key: "arrival", label: "Arrival", width: 1, format: "date" },
        { key: "reason", label: "Reason", width: 1.8 },
      ],
      rows: rows.map(({ _t, ...r }) => r),
    };
  },
};

// ─── Reservations with Deposits ─────────────────────────────────────────────
const deposits: ReportDef = {
  key: "res-deposits",
  module: "RESERVATIONS",
  name: "Reservations with Deposits",
  description: "Upcoming reservations (arriving in range) that hold a pre-arrival deposit, with balance.",
  params: [{ key: "range", label: "Arrival between", type: "dateRange", required: true, defaultToday: true }],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const range = rc.params.range as { from: Date; to: Date };
    const { gte, lt } = rangeBounds(range.from, range.to);
    const reservations = await prisma.reservation.findMany({
      where: {
        propertyId,
        checkInDate: { gte, lt },
        status: { in: ["RESERVED", "IN_HOUSE"] },
        folios: { some: { payments: { some: {} } } },
      },
      include: { primaryGuest: guestSelect, folios: { include: { lineItems: true, payments: true } } },
      orderBy: { checkInDate: "asc" },
    });
    const rows = reservations
      .map((r) => {
        const deposit = r.folios.reduce((s, f) => s + f.payments.reduce((x, p) => x + (p.isRefund ? -p.amount : p.amount), 0), 0);
        const balance = r.folios.reduce((s, f) => s + computeFolioBalance(f.lineItems, f.payments), 0);
        return { conf: r.confirmationNo, guest: guestName(r.primaryGuest), arrival: r.checkInDate, deposit, balance };
      })
      .filter((r) => Math.abs(r.deposit) > 0.005);
    return {
      title: "Reservations with Deposits",
      subtitle: `Arrivals ${fmtDay(gte)} – ${fmtDay(new Date(lt.getTime() - 86_400_000))} — ${rows.length} reservation(s)`,
      columns: [
        { key: "conf", label: "Confirmation", width: 1.2 },
        { key: "guest", label: "Guest", width: 2 },
        { key: "arrival", label: "Arrival", width: 1.1, format: "date" },
        { key: "deposit", label: "Deposit Held", width: 1, format: "currency" },
        { key: "balance", label: "Balance", width: 1, format: "currency" },
      ],
      rows,
      totals: { deposit: rows.reduce((s, r) => s + r.deposit, 0), balance: rows.reduce((s, r) => s + r.balance, 0) },
    };
  },
};

// ─── Reservation Traces ─────────────────────────────────────────────────────
const traces: ReportDef = {
  key: "res-traces",
  module: "RESERVATIONS",
  name: "Reservation Traces",
  description: "Operational traces (messages, wake-up calls, maintenance, front-desk) due in the range.",
  params: [
    { key: "range", label: "Trace date range", type: "dateRange", required: true, defaultToday: true },
    { key: "traceTypes", label: "Trace types", type: "multiSelect", optionSource: "traceTypes" },
    { key: "includeResolved", label: "Include resolved", type: "boolean" },
  ],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const range = rc.params.range as { from: Date; to: Date };
    const { gte, lt } = rangeBounds(range.from, range.to);
    const traceTypes = (rc.params.traceTypes as string[]) ?? [];
    const includeResolved = rc.params.includeResolved === true;

    const rows = await prisma.reservationTrace.findMany({
      where: {
        reservation: { propertyId },
        actionDate: { gte, lt },
        ...(traceTypes.length ? { traceType: { in: traceTypes } } : {}),
        ...(includeResolved ? {} : { isResolved: false }),
      },
      include: { reservation: { include: { primaryGuest: guestSelect } } },
      orderBy: { actionDate: "asc" },
    });
    return {
      title: "Reservation Traces",
      subtitle: `${fmtDay(gte)} – ${fmtDay(new Date(lt.getTime() - 86_400_000))} — ${rows.length} trace(s)`,
      columns: [
        { key: "date", label: "Action Date", width: 1.1, format: "date" },
        { key: "type", label: "Type", width: 1.1 },
        { key: "resolved", label: "Status", width: 0.8 },
        { key: "conf", label: "Confirmation", width: 1.1 },
        { key: "guest", label: "Guest", width: 1.5 },
        { key: "description", label: "Description", width: 2.4 },
      ],
      rows: rows.map((t) => ({
        date: t.actionDate,
        type: titleCase(t.traceType),
        resolved: t.isResolved ? "Resolved" : "Open",
        conf: t.reservation.confirmationNo,
        guest: guestName(t.reservation.primaryGuest),
        description: t.description,
      })),
    };
  },
};

export const RESERVATION_REPORTS: ReportDef[] = [availability, entered, cancellations, deposits, traces];
