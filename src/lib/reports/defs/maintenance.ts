import { prisma } from "@/lib/db";
import { rangeBounds } from "@/lib/reports/params";
import { propertyOrThrow, titleCase } from "@/lib/reports/defs/_shared";
import type { ReportDef, ReportResult } from "@/lib/reports/types";

const fmtDay = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const personName = (u: { firstName: string; lastName: string | null } | null) =>
  u ? `${u.firstName} ${u.lastName ?? ""}`.trim() : "—";

// ─── Maintenance Resolutions ────────────────────────────────────────────────
// The history behind the Maintenance board, which only keeps a ticket on screen for the
// business date it was resolved on. Filtered on the business date of the resolution.
const resolutions: ReportDef = {
  key: "maint-resolutions",
  module: "MAINTENANCE",
  name: "Maintenance Resolutions",
  description: "Maintenance tickets resolved in a date range, optionally for one technician.",
  insights: {
    kpis: [
      { label: "Resolved", agg: "count" },
      { label: "Rooms", agg: "distinct", column: "room" },
      { label: "Average days open", agg: "avg", column: "daysOpen" },
    ],
    visuals: [
      { type: "ranked", title: "Resolved per technician", by: "technician" },
      { type: "donut", title: "By issue type", by: "issueType", centerLabel: "tickets" },
    ],
  },
  params: [
    { key: "range", label: "Resolved between", type: "dateRange", required: true, defaultToday: true },
    {
      key: "technician",
      label: "Technician",
      type: "select",
      optionSource: "technicians",
      help: "The person the ticket was assigned to. Leave empty for everyone.",
    },
  ],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const { from, to } = rc.params.range as { from: Date; to: Date };
    const technician = (rc.params.technician as string | null) || null;
    const { gte, lt } = rangeBounds(from, to);

    const tickets = await prisma.roomMaintenance.findMany({
      where: {
        room: { propertyId },
        status: "RESOLVED",
        resolvedOn: { gte, lt },
        ...(technician ? { assignedToId: technician } : {}),
      },
      include: {
        room: { select: { roomNumber: true } },
        assignedTo: { select: { firstName: true, lastName: true } },
        resolvedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ resolvedOn: "desc" }, { resolvedAt: "desc" }],
    });

    const rows = tickets.map((t) => ({
      resolvedOn: t.resolvedOn,
      room: t.room.roomNumber,
      issueType: titleCase(t.issueType),
      description: t.description,
      priority: titleCase(t.priority),
      technician: t.assignedTo ? personName(t.assignedTo) : "Unassigned",
      resolvedBy: personName(t.resolvedBy),
      reported: t.createdAt,
      daysOpen: t.resolvedAt ? Math.max(0, Math.round((t.resolvedAt.getTime() - t.createdAt.getTime()) / 86_400_000)) : null,
    }));

    const picked = technician
      ? await prisma.user.findUnique({ where: { id: technician }, select: { firstName: true, lastName: true } })
      : null;
    const who = picked ? ` · ${personName(picked)}` : "";
    return {
      title: "Maintenance Resolutions",
      subtitle: `${fmtDay(gte)}${from.getTime() === to.getTime() ? "" : ` – ${fmtDay(to)}`}${who} — ${rows.length} ticket(s)`,
      note: "Filtered on the business date each ticket was resolved. Tickets resolved before resolution dates were recorded are dated by their last update.",
      columns: [
        { key: "resolvedOn", label: "Resolved", width: 1, format: "date" },
        { key: "room", label: "Room", width: 0.7 },
        { key: "issueType", label: "Issue", width: 1 },
        { key: "description", label: "Description", width: 2.6 },
        { key: "priority", label: "Priority", width: 0.8 },
        { key: "technician", label: "Technician", width: 1.3 },
        { key: "resolvedBy", label: "Resolved by", width: 1.3 },
        { key: "reported", label: "Reported", width: 1, format: "date" },
        { key: "daysOpen", label: "Days open", width: 0.7, format: "number", align: "right" },
      ],
      rows,
    };
  },
};

export const MAINTENANCE_REPORTS: ReportDef[] = [resolutions];
