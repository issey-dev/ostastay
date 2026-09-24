import { prisma } from "@/lib/db"
import { resolveBusinessDate } from "@/lib/business-date"
import { getPropertySettings } from "@/lib/property-settings"
import { systemContext } from "@/lib/reservations/system-context"
import { EOD_STEPS, getActiveEodRun } from "@/lib/eod"
import { runEodStep } from "@/lib/night-audit/eod-step"
import { isAuditTimeInWindow } from "@/lib/night-audit/audit-window"
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
//
// The audit time must fall between 22:00 and 06:00 (owner, 2026-09-24 — audit-window.ts);
// a time stored before that rule is reported and never run, rather than rolling the date
// in the middle of the day. The scheduled run also never force-closes a cashier's open
// drawer (a person running Night Audit does) — it stops at that step instead.

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

const SCHEDULER_USER_ID = "scheduled-night-audit"
const ymd = (d: Date) => d.toISOString().slice(0, 10)

export type ScheduledAuditOutcome = { propertyName: string; status: "RAN" | "STOPPED" | "BEHIND"; detail: string }

export async function runScheduledAudits(enterpriseId: string, now: Date = new Date()): Promise<JobResult> {
  const properties = await prisma.property.findMany({
    where: { enterpriseId, status: "ACTIVE" },
    select: { id: true, name: true, timeZone: true, businessDate: true },
    orderBy: { name: "asc" },
  })
  const ctx = systemContext(enterpriseId, SCHEDULER_USER_ID)
  const outcomes: ScheduledAuditOutcome[] = []

  // Each property on its own: one property's fault (a throw anywhere in a step) is
  // reported for that property and never keeps the others from being audited.
  for (const property of properties) {
    try {
      const outcome = await auditProperty(ctx, property, now)
      if (outcome) outcomes.push(outcome)
    } catch (err) {
      outcomes.push({ propertyName: property.name, status: "STOPPED", detail: `failed: ${err instanceof Error ? err.message : String(err)}` })
    }
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

async function auditProperty(
  ctx: ReturnType<typeof systemContext>,
  property: { id: string; name: string; timeZone: string | null; businessDate: Date | null },
  now: Date
): Promise<ScheduledAuditOutcome | null> {
  const settings = await getPropertySettings(property.id)
  if (!settings.autoAuditEnabled) return null

  // A run the scheduler started and couldn't finish (a later step failed after "post"
  // had already rolled the business date) is resumed first, whatever the time — otherwise
  // the rolled date makes it look not-due, its failure drops off the Overview on the next
  // tick, and its remaining steps (registration numbers, report snapshots) are skipped.
  // A run a person started is theirs to finish from the Night Audit screen.
  const active = await getActiveEodRun(property.id)
  if (active && active.startedByUserId === SCHEDULER_USER_ID) {
    return runAllSteps(ctx, property, active.businessDate)
  }

  if (!isAuditTimeInWindow(settings.autoAuditTime)) {
    return {
      propertyName: property.name,
      status: "STOPPED",
      detail: `scheduled time ${settings.autoAuditTime} is outside 22:00–06:00 — set a new time`,
    }
  }

  const businessDate = resolveBusinessDate(property)
  const late = minutesPastAuditTime(businessDate, settings.autoAuditTime, propertyLocalNow(property.timeZone || "UTC", now))
  if (late < 0) return null
  if (late >= 24 * 60) {
    return {
      propertyName: property.name,
      status: "BEHIND",
      detail: `business date ${ymd(businessDate)} is more than a day behind — run Night Audit from the property`,
    }
  }
  return runAllSteps(ctx, property, businessDate)
}

async function runAllSteps(
  ctx: ReturnType<typeof systemContext>,
  property: { id: string; name: string },
  auditedDate: Date
): Promise<ScheduledAuditOutcome> {
  for (const step of EOD_STEPS) {
    const res = await runEodStep(ctx, { propertyId: property.id, step: step.key }, { scheduled: true })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { propertyName: property.name, status: "STOPPED", detail: `stopped at "${step.label}": ${body.error ?? `HTTP ${res.status}`}` }
    }
  }
  return { propertyName: property.name, status: "RAN", detail: `audited ${ymd(auditedDate)}` }
}
