import { prisma } from "@/lib/db"
import { listBookings, type BookingView } from "@/lib/transport/bookings"
import { BILLING_STATUS_LABELS, BOOKING_STATUS_LABELS, DIRECTION_LABELS, label } from "@/lib/transport/constants"
import { dateToKey } from "@/lib/transport/time"
import type { ReportDef, ReportGroup, ReportResult } from "@/lib/reports/types"

// The Daily Transportation Report (section 3.4): arrivals and departures for a day or a
// range, grouped by day, transport type and direction, in departure order — each row with
// its departure (manifest), flight, airport rep, provider/vessel, status and billing state,
// and a pax subtotal per group. One definition, three outlets: the Daily Reports catalogue
// (PDF/Excel/CSV, REPORTS permission), the board's Export (TRANSPORTATION view, rate-
// limited — /api/transport/report) and the Booking API's report endpoint.

export async function transportReportResult(propertyId: string, from: string, to: string): Promise<ReportResult> {
  const { items } = await listBookings(propertyId, { from, to })
  const groups = new Map<string, BookingView[]>()
  const sorted = [...items].sort(
    (a, b) =>
      a.serviceDate.localeCompare(b.serviceDate) ||
      (a.transportType?.name ?? "~").localeCompare(b.transportType?.name ?? "~") ||
      a.direction.localeCompare(b.direction) ||
      (a.departureLocal?.time ?? a.flightLocal?.time ?? "99").localeCompare(b.departureLocal?.time ?? b.flightLocal?.time ?? "99")
  )
  for (const b of sorted) {
    const key = `${b.serviceDate} · ${b.transportType?.name ?? "No transport type"} · ${label(DIRECTION_LABELS, b.direction)}s`
    groups.set(key, [...(groups.get(key) ?? []), b])
  }
  const reportGroups: ReportGroup[] = [...groups.entries()].map(([g, rows]) => ({
    label: g,
    rows: rows.map((b) => ({
      time: b.departureLocal?.time ?? "—",
      departure: b.manifest ? `DEP-${b.manifest.id.slice(0, 6).toUpperCase()} ${b.manifest.departureLocal.time}` : "Unassigned",
      guest: `${b.guestName}${b.groupBlock ? ` [${b.groupBlock.code}]` : ""}`,
      reservation: b.reservation ? `${b.reservation.confirmationNo}${b.reservation.roomNumber ? ` / ${b.reservation.roomNumber}` : ""}` : "Standalone",
      pax: b.pax,
      flight: [b.flightNo, b.flightLocal?.time].filter(Boolean).join(" ") || "—",
      route: b.route ? `${b.route.origin.code} > ${b.route.destination.code}` : "—",
      rep: b.airportRep?.name ?? "—",
      provider: [b.provider?.name, b.vessel?.name].filter(Boolean).join(" / ") || "—",
      status: `${label(BOOKING_STATUS_LABELS, b.status)}${b.attention.length ? " (!)" : ""}`,
      billing: label(BILLING_STATUS_LABELS, b.billing.status),
    })),
    subtotals: { guest: `${rows.length} booking(s)`, pax: rows.filter((b) => b.status !== "NO_SHOW").reduce((s, b) => s + b.pax, 0) },
  }))
  const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { name: true } })
  return {
    title: "Daily Transportation Report",
    subtitle: `${property?.name ?? ""} — ${from === to ? from : `${from} to ${to}`}`,
    columns: [
      { key: "time", label: "Dep.", width: 0.6 },
      { key: "departure", label: "Departure", width: 1.2 },
      { key: "guest", label: "Guest", width: 1.7 },
      { key: "reservation", label: "Res. / room", width: 1.2 },
      { key: "pax", label: "Pax", width: 0.5, format: "number", align: "right" },
      { key: "flight", label: "Flight", width: 1 },
      { key: "route", label: "Route", width: 1 },
      { key: "rep", label: "Airport rep", width: 1.1 },
      { key: "provider", label: "Provider / vessel", width: 1.3 },
      { key: "status", label: "Status", width: 0.9 },
      { key: "billing", label: "Billing", width: 0.9 },
    ],
    groups: reportGroups,
    totals: { guest: `${items.length} booking(s)`, pax: items.filter((b) => b.status !== "NO_SHOW").reduce((s, b) => s + b.pax, 0) },
    note: items.some((b) => b.attention.length) ? "(!) = needs attention (flight timing or details) — see the Transportation board." : undefined,
  }
}

export const TRANSPORT_REPORTS: ReportDef[] = [
  {
    key: "transport-daily",
    module: "TRANSPORTATION",
    name: "Daily Transportation Report",
    description: "Arrival and departure transfers by transport type, with departures, flights, airport reps, providers, status and billing.",
    params: [{ key: "range", label: "Dates", type: "dateRange", required: true, defaultToday: true }],
    async run(rc) {
      if (!rc.propertyId) throw new Error("Choose a property")
      const range = rc.params.range as { from: Date; to: Date }
      return transportReportResult(rc.propertyId, dateToKey(range.from), dateToKey(range.to))
    },
  },
]
