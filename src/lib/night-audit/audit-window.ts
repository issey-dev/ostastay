import * as z from "zod"

// When the scheduled Night Audit may run (owner, 2026-09-24): between 22:00 and 06:00,
// inclusive. 22:00–23:59 runs on the business day itself; 00:00–06:00 in the small hours
// after it (see minutesPastAuditTime in scheduled.ts). Any other time would roll the date
// mid-day. No server imports here — the Hub form validates with the same rule.

export const AUDIT_WINDOW_MESSAGE = "Choose a time between 22:00 and 06:00"

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/** True when `hhmm` is a valid 24-hour time from 22:00 to 06:00 inclusive. */
export function isAuditTimeInWindow(hhmm: string): boolean {
  if (!HHMM.test(hhmm)) return false
  const [h, m] = hhmm.split(":").map(Number)
  const minutes = h * 60 + m
  return minutes >= 22 * 60 || minutes <= 6 * 60
}

/** True when the audit runs before midnight — on the business day itself. */
export function isAuditBeforeMidnight(hhmm: string): boolean {
  return isAuditTimeInWindow(hhmm) && Number(hhmm.slice(0, 2)) >= 22
}

export const auditTimeSchema = z
  .string()
  .regex(HHMM, "Use a 24-hour time, e.g. 02:00")
  .refine(isAuditTimeInWindow, AUDIT_WINDOW_MESSAGE)
