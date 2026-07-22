import { prisma } from "@/lib/db";
import { dayRange } from "@/lib/reports/params";
import { guestName, propertyOrThrow, guestSelect, titleCase } from "@/lib/reports/defs/_shared";
import type { ReportDef, ReportResult, ReportGroup } from "@/lib/reports/types";

const fmtDay = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

// ─── Special Requests ───────────────────────────────────────────────────────
const specialRequests: ReportDef = {
  key: "hk-special-requests",
  module: "HOUSEKEEPING",
  name: "Special Requests",
  description: "Guest special requests for stays in-house on the selected date.",
  params: [{ key: "date", label: "In-house on", type: "date", required: true, defaultToday: true }],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const date = rc.params.date as Date;
    const { gte } = dayRange(date);
    const reservations = await prisma.reservation.findMany({
      where: { propertyId, status: { in: ["RESERVED", "IN_HOUSE"] }, checkInDate: { lte: gte }, checkOutDate: { gt: gte }, specialRequests: { some: {} } },
      include: {
        primaryGuest: guestSelect,
        specialRequests: true,
        assignments: { include: { room: { select: { roomNumber: true } } } },
      },
      orderBy: { confirmationNo: "asc" },
    });
    const codes = await prisma.systemCode.findMany({ where: { enterpriseId: rc.ctx.enterpriseId, category: "SPECIAL_REQUEST" }, select: { code: true, value: true } });
    const label = new Map(codes.map((c) => [c.code, c.value]));

    const rows = reservations.flatMap((r) =>
      r.specialRequests.map((sr) => ({
        room: r.assignments.map((a) => a.room?.roomNumber).filter(Boolean).join(", ") || "—",
        guest: guestName(r.primaryGuest),
        request: label.get(sr.code) ?? sr.code,
        conf: r.confirmationNo,
      }))
    );
    return {
      title: "Special Requests",
      subtitle: `In-house on ${fmtDay(gte)} — ${rows.length} request(s)`,
      columns: [
        { key: "room", label: "Room", width: 0.8 },
        { key: "guest", label: "Guest", width: 1.8 },
        { key: "request", label: "Special Request", width: 2 },
        { key: "conf", label: "Confirmation", width: 1.2 },
      ],
      rows,
    };
  },
};

// ─── Attendant Report ───────────────────────────────────────────────────────
const attendant: ReportDef = {
  key: "hk-attendant",
  module: "HOUSEKEEPING",
  name: "Attendant Report",
  description: "Housekeeping tasks per attendant on the selected date, with time on task.",
  params: [{ key: "date", label: "Date", type: "date", required: true, defaultToday: true }],
  async run(rc): Promise<ReportResult> {
    const propertyId = await propertyOrThrow(rc);
    const date = rc.params.date as Date;
    const { gte, lt } = dayRange(date);
    const tasks = await prisma.housekeepingTask.findMany({
      where: { room: { propertyId }, scheduledDate: { gte, lt } },
      include: {
        room: { select: { roomNumber: true } },
        assignedTo: { include: { user: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: [{ assignedToId: "asc" }, { scheduledDate: "asc" }],
    });

    const minutes = (t: { startedAt: Date | null; completedAt: Date | null }): number | null =>
      t.startedAt && t.completedAt ? Math.max(0, Math.round((t.completedAt.getTime() - t.startedAt.getTime()) / 60_000)) : null;

    const byAttendant = new Map<string, { name: string; tasks: typeof tasks }>();
    for (const t of tasks) {
      const key = t.assignedToId ?? "unassigned";
      const name = t.assignedTo ? `${t.assignedTo.user.firstName} ${t.assignedTo.user.lastName ?? ""}`.trim() : "Unassigned";
      const b = byAttendant.get(key) ?? { name, tasks: [] as typeof tasks };
      b.tasks.push(t);
      byAttendant.set(key, b);
    }

    const groups: ReportGroup[] = Array.from(byAttendant.values()).map((b) => {
      let completed = 0, totalMin = 0;
      const rows = b.tasks.map((t) => {
        const m = minutes(t);
        if (t.status === "COMPLETED") completed += 1;
        if (m != null) totalMin += m;
        return {
          room: t.room.roomNumber,
          task: titleCase(t.taskType),
          status: titleCase(t.status),
          started: t.startedAt,
          completed: t.completedAt,
          mins: m,
        };
      });
      return {
        label: `${b.name} — ${b.tasks.length} task(s), ${completed} completed, ${totalMin} min`,
        rows,
        subtotals: { status: `${completed}/${b.tasks.length} done`, mins: totalMin },
      };
    });

    return {
      title: "Attendant Report",
      subtitle: fmtDay(gte),
      note: "Time on task = completed − started; blank where a task was completed without an in-progress start.",
      columns: [
        { key: "room", label: "Room", width: 0.8 },
        { key: "task", label: "Task", width: 1.2 },
        { key: "status", label: "Status", width: 1 },
        { key: "started", label: "Started", width: 1.1, format: "datetime" },
        { key: "completed", label: "Completed", width: 1.1, format: "datetime" },
        { key: "mins", label: "Mins", width: 0.6, format: "number" },
      ],
      groups,
    };
  },
};

export const HOUSEKEEPING_REPORTS: ReportDef[] = [specialRequests, attendant];
