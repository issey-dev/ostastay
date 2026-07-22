import { prisma } from "@/lib/db";
import { computeFolioBalance } from "@/lib/debtor-accounts";
import { dayRange, rangeBounds } from "@/lib/reports/params";
import { guestName, nights, isVip, primaryRoom, propertyOrThrow, guestSelect, assignmentInclude } from "@/lib/reports/defs/_shared";
import type { ReportDef, ReportResult } from "@/lib/reports/types";

// ─── Arrival Report ─────────────────────────────────────────────────────────
const arrival: ReportDef = {
  key: "fd-arrivals",
  module: "FRONT_DESK",
  name: "Arrival Report",
  description: "Guests due to arrive on the selected date (expected and already checked in).",
  params: [{ key: "date", label: "Arrival date", type: "date", required: true, defaultToday: true }],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const date = rc.params.date as Date;
    const { gte, lt } = dayRange(date);
    const rows = await prisma.reservation.findMany({
      where: { propertyId, checkInDate: { gte, lt }, status: { in: ["RESERVED", "IN_HOUSE"] } },
      include: { primaryGuest: guestSelect, assignments: assignmentInclude },
      orderBy: [{ status: "asc" }, { confirmationNo: "asc" }],
    });
    return {
      title: "Arrival Report",
      subtitle: `Arrivals for ${date.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}`,
      columns: [
        { key: "conf", label: "Confirmation", width: 1.3 },
        { key: "guest", label: "Guest", width: 1.8 },
        { key: "vip", label: "VIP", width: 0.5, align: "center" },
        { key: "roomType", label: "Room Type", width: 1.2 },
        { key: "room", label: "Room", width: 0.8 },
        { key: "nights", label: "Nts", width: 0.5, format: "number" },
        { key: "pax", label: "Pax", width: 0.6 },
        { key: "rate", label: "Rate", width: 0.9, format: "currency" },
        { key: "status", label: "Status", width: 0.9 },
      ],
      rows: rows.map((r) => ({
        conf: r.confirmationNo,
        guest: guestName(r.primaryGuest),
        vip: isVip(r.primaryGuest) ? "VIP" : "",
        roomType: r.assignments[0]?.roomType?.name ?? "—",
        room: primaryRoom(r.assignments),
        nights: nights(r.checkInDate, r.checkOutDate),
        pax: `${r.adults}/${r.children}`,
        rate: r.assignments[0]?.overrideRate ?? null,
        status: r.status === "IN_HOUSE" ? "Arrived" : "Expected",
      })),
    };
  },
};

// ─── Departure Report ───────────────────────────────────────────────────────
const departure: ReportDef = {
  key: "fd-departures",
  module: "FRONT_DESK",
  name: "Departure Report",
  description: "Guests due to depart on the selected date, with folio balances.",
  params: [
    { key: "date", label: "Departure date", type: "date", required: true, defaultToday: true },
    { key: "withBalanceOnly", label: "Only show balances due", type: "boolean" },
  ],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const date = rc.params.date as Date;
    const { gte, lt } = dayRange(date);
    const reservations = await prisma.reservation.findMany({
      where: { propertyId, checkOutDate: { gte, lt }, status: { in: ["IN_HOUSE", "CHECKED_OUT"] } },
      include: { primaryGuest: guestSelect, assignments: assignmentInclude, folios: { include: { lineItems: true, payments: true } } },
      orderBy: [{ status: "asc" }, { confirmationNo: "asc" }],
    });
    const withBalanceOnly = rc.params.withBalanceOnly === true;
    let rows = reservations.map((r) => {
      const balance = r.folios.reduce((s, f) => s + computeFolioBalance(f.lineItems, f.payments), 0);
      return {
        conf: r.confirmationNo,
        guest: guestName(r.primaryGuest),
        room: primaryRoom(r.assignments),
        nights: nights(r.checkInDate, r.checkOutDate),
        balance,
        status: r.status === "CHECKED_OUT" ? "Departed" : "Due out",
        _balance: balance,
      };
    });
    if (withBalanceOnly) rows = rows.filter((r) => Math.abs(r._balance) > 0.005);
    const total = rows.reduce((s, r) => s + r._balance, 0);
    return {
      title: "Departure Report",
      subtitle: `Departures for ${date.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}`,
      columns: [
        { key: "conf", label: "Confirmation", width: 1.3 },
        { key: "guest", label: "Guest", width: 2 },
        { key: "room", label: "Room", width: 0.9 },
        { key: "nights", label: "Nts", width: 0.5, format: "number" },
        { key: "status", label: "Status", width: 1 },
        { key: "balance", label: "Balance", width: 1, format: "currency" },
      ],
      rows: rows.map(({ _balance, ...r }) => r),
      totals: { balance: total },
    };
  },
};

// ─── In-House Guest List ────────────────────────────────────────────────────
const inHouse: ReportDef = {
  key: "fd-in-house",
  module: "FRONT_DESK",
  name: "In-House Guest List",
  description: "Guests in-house on the selected night, with balances.",
  params: [
    { key: "date", label: "Night of", type: "date", required: true, defaultToday: true },
    { key: "vipOnly", label: "VIP only", type: "boolean" },
  ],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const date = rc.params.date as Date;
    const { gte } = dayRange(date);
    const reservations = await prisma.reservation.findMany({
      where: { propertyId, status: "IN_HOUSE", checkInDate: { lte: gte }, checkOutDate: { gt: gte } },
      include: { primaryGuest: guestSelect, assignments: assignmentInclude, folios: { include: { lineItems: true, payments: true } } },
      orderBy: { confirmationNo: "asc" },
    });
    const vipOnly = rc.params.vipOnly === true;
    let rows = reservations.map((r) => ({
      room: primaryRoom(r.assignments),
      guest: guestName(r.primaryGuest),
      vip: isVip(r.primaryGuest) ? "VIP" : "",
      conf: r.confirmationNo,
      arrival: r.checkInDate,
      departure: r.checkOutDate,
      nights: nights(r.checkInDate, r.checkOutDate),
      pax: `${r.adults}/${r.children}`,
      balance: r.folios.reduce((s, f) => s + computeFolioBalance(f.lineItems, f.payments), 0),
      _vip: isVip(r.primaryGuest),
    }));
    if (vipOnly) rows = rows.filter((r) => r._vip);
    const total = rows.reduce((s, r) => s + r.balance, 0);
    return {
      title: "In-House Guest List",
      subtitle: `In-house on ${date.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })} — ${rows.length} room(s)`,
      columns: [
        { key: "room", label: "Room", width: 0.8 },
        { key: "guest", label: "Guest", width: 1.8 },
        { key: "vip", label: "VIP", width: 0.5, align: "center" },
        { key: "conf", label: "Confirmation", width: 1.2 },
        { key: "arrival", label: "Arrival", width: 1, format: "date" },
        { key: "departure", label: "Departure", width: 1, format: "date" },
        { key: "nights", label: "Nts", width: 0.5, format: "number" },
        { key: "pax", label: "Pax", width: 0.6 },
        { key: "balance", label: "Balance", width: 0.9, format: "currency" },
      ],
      rows: rows.map(({ _vip, ...r }) => r),
      totals: { balance: total },
    };
  },
};

// ─── Guest Event Calendar (birthdays / anniversaries) ───────────────────────
const guestEvents: ReportDef = {
  key: "fd-guest-events",
  module: "FRONT_DESK",
  name: "Guest Event Calendar",
  description: "Birthdays and anniversaries of guests staying during the selected period.",
  params: [{ key: "range", label: "Stay period", type: "dateRange", required: true, defaultToday: true }],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const range = rc.params.range as { from: Date; to: Date };
    const { gte, lt } = rangeBounds(range.from, range.to);
    // Reservations whose stay overlaps the window and are (or will be) present.
    const reservations = await prisma.reservation.findMany({
      where: { propertyId, status: { in: ["RESERVED", "IN_HOUSE"] }, checkInDate: { lt }, checkOutDate: { gt: gte } },
      include: { primaryGuest: guestSelect, assignments: assignmentInclude },
    });

    // Does a month/day event fall within [from, to] (inclusive, ignoring year)?
    const from = gte;
    const toInclusive = new Date(lt.getTime() - 86_400_000);
    const eventInWindow = (d: Date): Date | null => {
      for (let y = from.getUTCFullYear(); y <= toInclusive.getUTCFullYear(); y++) {
        const occ = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
        if (occ >= from && occ <= toInclusive) return occ;
      }
      return null;
    };

    const rows: Record<string, unknown>[] = [];
    for (const r of reservations) {
      const g = r.primaryGuest;
      if (!g) continue;
      for (const [field, type] of [["dateOfBirth", "Birthday"], ["anniversaryDate", "Anniversary"]] as const) {
        const val = g[field];
        if (!val) continue;
        const occ = eventInWindow(val);
        if (!occ) continue;
        rows.push({
          date: occ,
          event: type,
          guest: guestName(g),
          room: primaryRoom(r.assignments),
          conf: r.confirmationNo,
          stay: `${r.checkInDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" })} – ${r.checkOutDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" })}`,
        });
      }
    }
    rows.sort((a, b) => (a.date as Date).getTime() - (b.date as Date).getTime());
    return {
      title: "Guest Event Calendar",
      subtitle: `Birthdays & anniversaries, ${from.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })} – ${toInclusive.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}`,
      columns: [
        { key: "date", label: "Date", width: 1, format: "date" },
        { key: "event", label: "Event", width: 1 },
        { key: "guest", label: "Guest", width: 1.8 },
        { key: "room", label: "Room", width: 0.8 },
        { key: "conf", label: "Confirmation", width: 1.2 },
        { key: "stay", label: "Stay", width: 1.4 },
      ],
      rows,
    };
  },
};

// ─── Outlet Calendar / Daily Schedule ───────────────────────────────────────
const outletCalendar: ReportDef = {
  key: "fd-outlet-calendar",
  module: "FRONT_DESK",
  name: "Outlet Calendar",
  description: "Outlet bookings for the selected date — the day's schedule.",
  params: [
    { key: "date", label: "Date", type: "date", required: true, defaultToday: true },
    { key: "outletIds", label: "Outlets", type: "multiSelect", optionSource: "outlets" },
  ],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const date = rc.params.date as Date;
    const { gte, lt } = dayRange(date);
    const outletIds = (rc.params.outletIds as string[]) ?? [];
    const appts = await prisma.outletAppointment.findMany({
      where: {
        outlet: { propertyId },
        startTime: { gte, lt },
        ...(outletIds.length ? { outletId: { in: outletIds } } : {}),
      },
      include: {
        outlet: { select: { name: true } },
        chargeCode: { select: { description: true } },
        reservation: { include: { primaryGuest: guestSelect } },
      },
      orderBy: { startTime: "asc" },
    });
    return {
      title: "Outlet Calendar",
      subtitle: `Schedule for ${date.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })} — ${appts.length} booking(s)`,
      columns: [
        { key: "time", label: "Time", width: 0.9, format: "datetime" },
        { key: "outlet", label: "Outlet", width: 1.2 },
        { key: "guest", label: "Guest", width: 1.6 },
        { key: "service", label: "Service", width: 1.4 },
        { key: "status", label: "Status", width: 0.9 },
        { key: "notes", label: "Notes", width: 1.6 },
      ],
      rows: appts.map((a) => ({
        time: a.startTime,
        outlet: a.outlet.name,
        guest: a.reservation ? guestName(a.reservation.primaryGuest) : a.walkInGuestName || "Walk-in",
        service: a.chargeCode?.description ?? "—",
        status: a.status.charAt(0) + a.status.slice(1).toLowerCase(),
        notes: a.notes ?? "",
      })),
    };
  },
};

export const FRONT_DESK_REPORTS: ReportDef[] = [arrival, departure, inHouse, guestEvents, outletCalendar];
