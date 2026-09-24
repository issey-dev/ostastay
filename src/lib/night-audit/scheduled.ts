import { prisma } from "@/lib/db"
import { resolveBusinessDate } from "@/lib/business-date"
import { getPropertySettings } from "@/lib/property-settings"
import { systemContext } from "@/lib/reservations/system-context"
import { EOD_STEPS } from "@/lib/eod"
import { runEodStep } from "@/lib/night-audit/eod-step"
import type { JobResult } from "@/lib/jobs/runner"

// The scheduled Night Audit (Hub > the property > Night Audit > Scheduled Night Audit):
// the background jobs run a property's whole End-of-Day at its chosen time, in its own
// time zone, with no one at the desk. It runs exactly the steps a person would, through
// the same code (runEodStep), and stops at the first step that needs a person — guests
// still due out, a missing charge code — leaving the run to be resumed from the Night
// Audit screen. A stop makes the job fail, which the Hub Overview shows.
//
// When the audit of business date D is due: an audit time before noon runs in the small
// hours AFTER that day (02:00 on D+1 closes D); a time from noon on runs on D itself
// (23:30 on D closes D). It only runs once it is due and never more than a day late — a
// property whose business date is further behind is reported, not caught up night after
// night by the scheduler.

const DAY_MS = 24 * 60 * 60 * 1000

/** A property's local calendar date (as a UTC midnight) and minutes past local midnight. */
export function propertyLocalNow(timeZone: string, now: Date = new Date()): { date: Date; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return { date: new Date(Date.UTC(get("year"), get("month") - 1, get("day"))), minutes: get("hour") * 60 + get("minute") }
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + m
}

/** How many minutes the audit of `businessDate` is overdue (negative = not due yet). */
export function minutesPastAuditTime(businessDate: Date, auditTime: string, local: { date: Date; minutes: number }): number {
  const auditMinutes = toMinutes(auditTime)
  // Before noon: the small hours of the NEXT day. From noon: the same day.
  const dueDay = businessDate.getTime() + (auditMinutes < 12 * 60 ? DAY_MS : 0)
  return (local.date.getTime() - dueDay) / 60000 + (local.minutes - auditMinutes)
}

export type ScheduledAuditOutcome = { propertyName: string; status: "RAN" | "STOPPED" | "BEHIND"; detail: string }

export async function runScheduledAudits(enterpriseId: string, now: Date = new Date()): Promise<JobResult> {
  const properties = await prisma.property.findMany({
    where: { enterpriseId, status: "ACTIVE" },
    select: { id: true, name: true, timeZone: true, businessDate: true },
  })
  const ctx = systemContext(enterpriseId, "scheduled-night-audit")
  const outcomes: ScheduledAuditOutcome[] = []

  for (const property of properties) {
    const settings = await getPropertySettings(property.id)
    if (!settings.autoAuditEnabled) continue
    const businessDate = resolveBusinessDate(property)
    const late = minutesPastAuditTime(businessDate, settings.autoAuditTime, propertyLocalNow(property.timeZone || "UTC", now))
    if (late < 0) continue
    if (late >= 24 * 60) {
      outcomes.push({
        propertyName: property.name,
        status: "BEHIND",
        detail: `business date ${businessDate.toISOString().slice(0, 10)} is more than a day behind — run Night Audit from the property`,
      })
      continue
    }

    let stopped: string | null = null
    for (const step of EOD_STEPS) {
      const res = await runEodStep(ctx, { propertyId: property.id, step: step.key })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        stopped = `stopped at "${step.label}": ${body.error ?? `HTTP ${res.status}`}`
        break
      }
    }
    outcomes.push(
      stopped
        ? { propertyName: property.name, status: "STOPPED", detail: stopped }
        : { propertyName: property.name, status: "RAN", detail: `audited ${businessDate.toISOString().slice(0, 10)}` }
    )
  }

  const ran = outcomes.filter((o) => o.status === "RAN")
  const problems = outcomes.filter((o) => o.status !== "RAN")
  const line = (o: ScheduledAuditOutcome) => `${o.propertyName}: ${o.detail}`
  if (problems.length > 0) {
    // Failing the job is what puts it on the Hub Overview; the properties that did run are
    // named too, so the message is the whole story.
    throw new Error([...problems.map(line), ...ran.map(line)].join("; "))
  }
  return { itemsProcessed: ran.length, summary: ran.length ? ran.map(line).join("; ") : "No scheduled audit due" }
}
