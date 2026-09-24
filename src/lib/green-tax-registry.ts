import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { isStayBasis, meetsMinStay, sheetGuestName, type PropertyTimes, type StayBasis } from "@/lib/green-tax-sheet";

// ─── Green Tax registration register: review, correct, file ──────────────────
// Owner rules (2026-09-23, see DECISIONS "Green Tax Report = MIRA information sheet"):
//   · Per property the Reg No runs 1..n each calendar year in check-in order and must
//     NEVER have a gap. Taking a number away therefore renumbers every later guest down
//     by one; there is no "void and leave the hole".
//   · The sheet is filed with MIRA monthly by stay date. Once a month is filed, no number
//     carried by any guest who stayed in it may change — so a correction is refused if
//     any number it would move is locked. Fix before filing; there is no un-file.
// Corrections run under a per-property advisory lock, the same one the EOD numbering
// step takes, so a renumbering can never interleave with new numbers being assigned.

export class GreenTaxError extends Error {
  constructor(message: string, public status = 409) {
    super(message);
  }
}

export type RegistrationIssue = "PM_ROOM" | "SHORT_STAY" | "NOT_STAYED" | "NOT_ON_BOOKING";
export const ISSUE_LABELS: Record<RegistrationIssue, string> = {
  PM_ROOM: "Stayed in a PM (pseudo) room",
  SHORT_STAY: "Stay under 12 hours",
  NOT_STAYED: "Booking cancelled, no-show or check-in reversed",
  NOT_ON_BOOKING: "Guest no longer on the booking",
};

const monthStart = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 1));
const monthEnd = (year: number, month: number) => new Date(Date.UTC(year, month, 1)); // exclusive
const stayedIn = (r: { checkInDate: Date; checkOutDate: Date }, from: Date, to: Date) =>
  r.checkInDate < to && r.checkOutDate > from;

/** Serialize with the EOD numbering step and other corrections for this property. */
export async function lockPropertySequence(tx: Prisma.TransactionClient, propertyId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"green-tax:" + propertyId}))`;
}

async function propertyRules(propertyId: string): Promise<PropertyTimes & { basis: StayBasis; businessDate: Date | null }> {
  const p = await prisma.property.findUniqueOrThrow({
    where: { id: propertyId },
    select: {
      timeZone: true, checkInTime: true, checkOutTime: true, businessDate: true,
      settings: { select: { greenTaxStayBasis: true } },
    },
  });
  const b = p.settings?.greenTaxStayBasis;
  return { timeZone: p.timeZone, checkInTime: p.checkInTime, checkOutTime: p.checkOutTime, businessDate: p.businessDate, basis: isStayBasis(b) ? b : "ACTUAL" };
}

const REG_INCLUDE = {
  profile: { select: { firstName: true, middleName: true, lastName: true } },
  reservation: {
    select: {
      id: true, confirmationNo: true, status: true, primaryGuestId: true,
      checkInDate: true, checkOutDate: true, checkedInAt: true, checkedOutAt: true,
      assignments: { select: { roomType: { select: { isPseudo: true } }, room: { select: { roomNumber: true } } } },
      accompanyingGuests: { select: { profileId: true } },
    },
  },
} as const;
type RegRow = Prisma.GuestRegistrationGetPayload<{ include: typeof REG_INCLUDE }>;

function issuesFor(r: RegRow, rules: PropertyTimes & { basis: StayBasis }): RegistrationIssue[] {
  const res = r.reservation;
  const out: RegistrationIssue[] = [];
  if (res.status !== "IN_HOUSE" && res.status !== "CHECKED_OUT") out.push("NOT_STAYED");
  if (!res.assignments.some((a) => !a.roomType.isPseudo)) out.push("PM_ROOM");
  if (!out.includes("NOT_STAYED") && !meetsMinStay(res, rules, rules.basis)) out.push("SHORT_STAY");
  const onBooking = res.primaryGuestId === r.profileId || res.accompanyingGuests.some((a) => a.profileId === r.profileId);
  if (!onBooking) out.push("NOT_ON_BOOKING");
  return out;
}

// Highest number of `year` that a filed month has published — every number up to it is
// frozen, since renumbering only ever moves numbers above the one being changed. Filings
// from the next January count too: a December arrival staying into January is on that
// sheet with this year's number.
async function lockedThrough(propertyId: string, year: number, regs: RegRow[], db: Prisma.TransactionClient = prisma): Promise<number> {
  const filings = await db.greenTaxFiling.findMany({ where: { propertyId, year: { in: [year, year + 1] } }, select: { year: true, month: true } });
  let max = 0;
  for (const f of filings) {
    const from = monthStart(f.year, f.month), to = monthEnd(f.year, f.month);
    for (const r of regs) if (r.registrationNo > max && stayedIn(r.reservation, from, to)) max = r.registrationNo;
  }
  return max;
}

async function loadYear(propertyId: string, year: number, db: Prisma.TransactionClient = prisma) {
  return db.guestRegistration.findMany({ where: { propertyId, year }, include: REG_INCLUDE, orderBy: { registrationNo: "asc" } });
}

// ─── Overview for the Hub page ─────────────────────────────────────────────────
export async function registerOverview(propertyId: string, year: number) {
  const [rules, regs, filings, corrections] = await Promise.all([
    propertyRules(propertyId),
    loadYear(propertyId, year),
    prisma.greenTaxFiling.findMany({ where: { propertyId, year }, orderBy: { month: "asc" } }),
    prisma.greenTaxCorrection.findMany({ where: { propertyId, year }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const locked = await lockedThrough(propertyId, year, regs);

  const exceptions = regs
    .map((r) => ({ r, issues: issuesFor(r, rules) }))
    .filter((x) => x.issues.length > 0)
    .map(({ r, issues }) => ({
      registrationId: r.id,
      registrationNo: r.registrationNo,
      guest: sheetGuestName(r.profile),
      confirmationNo: r.reservation.confirmationNo,
      reservationId: r.reservation.id,
      room: r.reservation.assignments.map((a) => a.room?.roomNumber).filter(Boolean).join(", "),
      checkInDate: r.reservation.checkInDate,
      checkOutDate: r.reservation.checkOutDate,
      issues: issues.map((i) => ({ code: i, label: ISSUE_LABELS[i] })),
      locked: r.registrationNo <= locked,
    }));

  const present = new Set(regs.map((r) => r.registrationNo));
  const maxNo = regs.length ? regs[regs.length - 1].registrationNo : 0;
  const gaps: { registrationNo: number; locked: boolean }[] = [];
  for (let n = 1; n < maxNo; n++) if (!present.has(n)) gaps.push({ registrationNo: n, locked: n <= locked });

  const filed = new Map(filings.map((f) => [f.month, f]));
  const months = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const stays = regs.filter((r) => stayedIn(r.reservation, monthStart(year, month), monthEnd(year, month)));
    const f = filed.get(month);
    return {
      month,
      guests: stays.length,
      firstNo: stays.length ? Math.min(...stays.map((r) => r.registrationNo)) : null,
      lastNo: stays.length ? Math.max(...stays.map((r) => r.registrationNo)) : null,
      filedAt: f?.filedAt ?? null,
      filedById: f?.filedById ?? null,
    };
  });

  return {
    year,
    basis: rules.basis,
    businessDate: rules.businessDate,
    total: regs.length,
    lastNo: maxNo,
    lockedThrough: locked,
    months,
    exceptions,
    gaps,
    corrections,
  };
}

// Renumber every registration of `year` above `after` down by one. Two passes through
// negative numbers so no row ever collides on @@unique([propertyId, year, registrationNo])
// mid-statement.
async function shiftDown(tx: Prisma.TransactionClient, propertyId: string, year: number, after: number) {
  const moved = await tx.$executeRaw`
    UPDATE "GuestRegistration" SET "registrationNo" = -("registrationNo" - 1)
    WHERE "propertyId" = ${propertyId} AND "year" = ${year} AND "registrationNo" > ${after}`;
  await tx.$executeRaw`
    UPDATE "GuestRegistration" SET "registrationNo" = -"registrationNo"
    WHERE "propertyId" = ${propertyId} AND "year" = ${year} AND "registrationNo" < 0`;
  // Keep the counter pointing at the (new) last number, so the next arrival follows on.
  const last = await tx.guestRegistration.aggregate({ where: { propertyId, year }, _max: { registrationNo: true } });
  await tx.propertySequence.updateMany({
    where: { propertyId, sequenceType: "GUEST_REG_NO", resetYear: year },
    data: { currentValue: last._max.registrationNo ?? 0 },
  });
  return moved;
}

function assertReason(reason: unknown): string {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (r.length < 5) throw new GreenTaxError("Give a reason for the correction (at least 5 characters).", 400);
  return r;
}

function lockedMessage(no: number, locked: number) {
  return `Reg No ${no} can't be changed: numbers up to ${locked} have been filed with MIRA. ` +
    "Correct it outside the system before the next submission.";
}

/** Remove a wrongly given number; every later number of the year moves down by one. */
export async function removeRegistration(input: { propertyId: string; registrationId: string; reason: unknown; userId: string }) {
  const reason = assertReason(input.reason);
  return prisma.$transaction(async (tx) => {
    await lockPropertySequence(tx, input.propertyId);
    const reg = await tx.guestRegistration.findUnique({ where: { id: input.registrationId }, include: REG_INCLUDE });
    if (!reg || reg.propertyId !== input.propertyId) throw new GreenTaxError("Registration not found.", 404);

    const rules = await propertyRules(input.propertyId);
    const regs = await loadYear(input.propertyId, reg.year, tx);
    const locked = await lockedThrough(input.propertyId, reg.year, regs, tx);
    if (reg.registrationNo <= locked) throw new GreenTaxError(lockedMessage(reg.registrationNo, locked));

    const issues = issuesFor(reg, rules);
    const lastNo = regs[regs.length - 1].registrationNo;
    await tx.guestRegistration.delete({ where: { id: reg.id } });
    await shiftDown(tx, input.propertyId, reg.year, reg.registrationNo);

    return tx.greenTaxCorrection.create({
      data: {
        propertyId: input.propertyId,
        year: reg.year,
        action: "REMOVE",
        registrationNo: reg.registrationNo,
        guestName: sheetGuestName(reg.profile),
        confirmationNo: reg.reservation.confirmationNo,
        issue: issues.join(",") || null,
        reason,
        shiftFrom: lastNo > reg.registrationNo ? reg.registrationNo + 1 : null,
        shiftTo: lastNo > reg.registrationNo ? lastNo : null,
        userId: input.userId,
      },
    });
  });
}

/** Close a hole in the sequence (e.g. a registration lost with a deleted booking). */
export async function closeGap(input: { propertyId: string; year: number; registrationNo: number; reason: unknown; userId: string }) {
  const reason = assertReason(input.reason);
  return prisma.$transaction(async (tx) => {
    await lockPropertySequence(tx, input.propertyId);
    const regs = await loadYear(input.propertyId, input.year, tx);
    const n = input.registrationNo;
    const lastNo = regs.length ? regs[regs.length - 1].registrationNo : 0;
    if (!Number.isInteger(n) || n < 1 || n >= lastNo || regs.some((r) => r.registrationNo === n)) {
      throw new GreenTaxError(`Reg No ${n} is not a gap in ${input.year}.`, 400);
    }
    const locked = await lockedThrough(input.propertyId, input.year, regs, tx);
    if (n <= locked) throw new GreenTaxError(lockedMessage(n, locked));

    await shiftDown(tx, input.propertyId, input.year, n);
    return tx.greenTaxCorrection.create({
      data: {
        propertyId: input.propertyId, year: input.year, action: "CLOSE_GAP", registrationNo: n,
        reason, shiftFrom: n + 1, shiftTo: lastNo, userId: input.userId,
      },
    });
  });
}

/** Mark a month as submitted to MIRA — from then on its numbers are frozen. */
export async function fileMonth(input: { propertyId: string; year: number; month: number; userId: string; note?: string | null }) {
  const { propertyId, year, month } = input;
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new GreenTaxError("Invalid month.", 400);
  return prisma.$transaction(async (tx) => {
    await lockPropertySequence(tx, propertyId);
    if (await tx.greenTaxFiling.findUnique({ where: { propertyId_year_month: { propertyId, year, month } } })) {
      throw new GreenTaxError("This month is already filed.");
    }
    const rules = await propertyRules(propertyId);
    const from = monthStart(year, month), to = monthEnd(year, month);
    if (!rules.businessDate || rules.businessDate < to) {
      throw new GreenTaxError("The month isn't over yet — file it once the business date has moved past its last day.");
    }
    // Months are filed in order: filing this one freezes every number up to its last,
    // which would leave an unfiled earlier month's mistakes impossible to correct.
    const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
    const prevFiled = await tx.greenTaxFiling.findUnique({ where: { propertyId_year_month: { propertyId, year: prev.y, month: prev.m } } });
    if (!prevFiled) {
      const prevStays = await tx.guestRegistration.count({
        where: { propertyId, reservation: { checkInDate: { lt: monthEnd(prev.y, prev.m) }, checkOutDate: { gt: monthStart(prev.y, prev.m) } } },
      });
      if (prevStays > 0) throw new GreenTaxError(`File ${monthName(prev.m)} ${prev.y} first.`);
    }

    // Nothing correctable may be left in the numbers this filing freezes.
    const years = [year - 1, year];
    for (const y of years) {
      const regs = await loadYear(propertyId, y, tx);
      const monthRegs = regs.filter((r) => stayedIn(r.reservation, from, to));
      if (!monthRegs.length) continue;
      const locked = await lockedThrough(propertyId, y, regs, tx);
      const upTo = Math.max(...monthRegs.map((r) => r.registrationNo));
      const open = regs.filter((r) => r.registrationNo > locked && r.registrationNo <= upTo && issuesFor(r, rules).length > 0);
      if (open.length) {
        throw new GreenTaxError(`Resolve ${open.length} flagged registration(s) first (Reg No ${open.map((r) => r.registrationNo).join(", ")}).`);
      }
      const present = new Set(regs.map((r) => r.registrationNo));
      for (let n = locked + 1; n < upTo; n++) {
        if (!present.has(n)) throw new GreenTaxError(`Close the gap at Reg No ${n} (${y}) first.`);
      }
    }

    return tx.greenTaxFiling.create({ data: { propertyId, year, month, filedById: input.userId, note: input.note?.trim() || null } });
  });
}

export function monthName(m: number) {
  return new Date(Date.UTC(2000, m - 1, 1)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
}
