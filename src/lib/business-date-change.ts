import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { lockKeys } from "@/lib/db-lock"
import { resolveBusinessDate, toUtcMidnight } from "@/lib/business-date"
import { ForbiddenError } from "@/lib/scope"

// Moving a property's business date by hand (Hub > the property > Night Audit) — owner,
// 2026-09-23. Night Audit is what normally moves it, one day at a time, after it has
// resolved the day's arrivals, departures, cashiers and postings. A manual move skips all
// of that, so it is allowed only when there is nothing for the skipped days to have
// resolved:
//
//   A FRESH property (nothing has happened there yet: no reservations, folios, cashier
//   shifts, audits, spa appointments or excursion bookings) may be set to ANY date — this
//   is how a newly provisioned property is put on its go-live date.
//
//   Otherwise the date may only move FORWARD, and only when:
//     - no guest is in house;
//     - no reservation is due to arrive before the new date (it would be skipped over);
//     - there are no financial records (folio postings) on or after the current business
//       date — the days being skipped, and today, which has not been audited;
//     - no cashier shift is open, and Night Audit is not running;
//     - no spa appointment or excursion booking falls on the skipped days.
//
// The checks are re-run inside the transaction that moves the date, under a per-property
// lock, so a check can't pass on stale data.

export type BusinessDateCheck = { key: string; label: string; ok: boolean; detail: string | null }

export type BusinessDateAssessment = {
  current: string
  target: string
  /** Nothing has happened at this property yet — any date is allowed. */
  fresh: boolean
  checks: BusinessDateCheck[]
  allowed: boolean
}

type Db = Prisma.TransactionClient | typeof prisma

const day = (d: Date) => d.toISOString().slice(0, 10)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Parse a YYYY-MM-DD business date. */
export function parseBusinessDate(input: unknown): Date {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input)) throw new ForbiddenError("Choose a valid date")
  const d = new Date(`${input}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) throw new ForbiddenError("Choose a valid date")
  return d
}

export async function assessBusinessDateChange(propertyId: string, targetInput: Date, db: Db = prisma): Promise<BusinessDateAssessment> {
  const property = await db.property.findUniqueOrThrow({ where: { id: propertyId }, select: { businessDate: true } })
  const current = resolveBusinessDate(property)
  const target = toUtcMidnight(targetInput)
  const folioScope = { folio: { propertyId } }

  const [reservations, folios, shifts, audits, spa, excursions, auditRunning] = await Promise.all([
    db.reservation.count({ where: { propertyId } }),
    db.folio.count({ where: { propertyId } }),
    db.cashierShift.count({ where: { propertyId } }),
    db.eodRun.count({ where: { propertyId } }),
    db.spaAppointment.count({ where: { propertyId } }),
    db.excursionBooking.count({ where: { propertyId } }),
    db.eodRun.count({ where: { propertyId, status: "IN_PROGRESS" } }),
  ])
  const fresh = reservations + folios + shifts + audits + spa + excursions === 0

  const checks: BusinessDateCheck[] = []
  const add = (key: string, label: string, count: number, detail: string) =>
    checks.push({ key, label, ok: count === 0, detail: count === 0 ? null : detail })

  checks.push({
    key: "different",
    label: "A different date from the current business date",
    ok: target.getTime() !== current.getTime(),
    detail: target.getTime() === current.getTime() ? "That is already the business date." : null,
  })
  add("audit", "Night Audit is not running", auditRunning, "Night Audit is in progress — wait for it to finish.")

  if (!fresh) {
    const [inHouse, arrivals, postings, openShifts, spaInWindow, excursionsInWindow] = await Promise.all([
      db.reservation.count({ where: { propertyId, status: "IN_HOUSE" } }),
      db.reservation.count({ where: { propertyId, status: "RESERVED", checkInDate: { lt: target } } }),
      db.folioLineItem.count({ where: { ...folioScope, date: { gte: current } } }),
      db.cashierShift.count({ where: { propertyId, closedAt: null } }),
      db.spaAppointment.count({
        where: { propertyId, appointmentDate: { gte: current, lt: target }, appointmentStatus: { notIn: ["CANCELLED", "NO_SHOW", "COMPLETED"] } },
      }),
      db.excursionBooking.count({
        where: { propertyId, status: "CONFIRMED", departure: { departureDate: { gte: current, lt: target } } },
      }),
    ])
    checks.push({
      key: "forward",
      label: "Moves forward — a property with activity cannot go back in time",
      ok: target.getTime() > current.getTime(),
      detail: target.getTime() > current.getTime() ? null : `Choose a date after ${day(current)}.`,
    })
    add("in-house", "No guests in house", inHouse, `${plural(inHouse, "reservation is", "reservations are")} in house.`)
    add("arrivals", "No reservations due to arrive before the new date", arrivals, `${plural(arrivals, "reservation")} would be skipped over — check them in, move or cancel them first.`)
    add("postings", "No financial records on or after the current business date", postings, `${plural(postings, "folio posting")} dated ${day(current)} or later.`)
    add("shifts", "No cashier shift open", openShifts, `${plural(openShifts, "cashier shift")} still open — close ${openShifts === 1 ? "it" : "them"} first.`)
    add("activities", "No spa appointments or excursion bookings on the skipped days", spaInWindow + excursionsInWindow, `${plural(spaInWindow, "spa appointment")} and ${plural(excursionsInWindow, "excursion booking")} fall before the new date.`)
  }

  return { current: day(current), target: day(target), fresh, checks, allowed: checks.every((c) => c.ok) }
}

/** Move the business date — refused (with the failing checks named) unless every check passes. */
export async function changeBusinessDate(propertyId: string, target: Date): Promise<BusinessDateAssessment> {
  return prisma.$transaction(async (tx) => {
    await lockKeys(tx, [`property:${propertyId}:business-date`])
    const assessment = await assessBusinessDateChange(propertyId, target, tx)
    if (!assessment.allowed) {
      const failing = assessment.checks.filter((c) => !c.ok).map((c) => c.detail ?? c.label)
      throw new ForbiddenError(`The business date cannot be changed: ${failing.join(" ")}`)
    }
    await tx.property.update({
      where: { id: propertyId },
      // Like Night Audit, sign property staff out so nobody keeps working on the old date.
      data: { businessDate: toUtcMidnight(target), eodSessionsInvalidAt: new Date() },
    })
    return assessment
  })
}
