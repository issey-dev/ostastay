import { prisma } from "@/lib/db"
import { resolveBusinessDate } from "@/lib/business-date"
import { addDaysKey, dateToKey } from "@/lib/transport/time"
import { listBookings } from "@/lib/transport/bookings"
import { notify } from "./notify"

// Alerts that are not caused by one click but by the clock: a transfer that no longer fits
// its flight, a cashier shift nobody closed, a group cut-off coming up. A job runs these
// scans for every property (src/lib/jobs/index.ts "notification-alerts"); each alert carries
// a dedupe key, so running the scan again every few minutes raises it once.

/** A shift open this long is "left open". */
export const SHIFT_OPEN_HOURS = 16

/** How far ahead a transfer's problems are worth telling people about. */
export const TRANSPORT_LOOKAHEAD_DAYS = 2

/** Pure: how close is a group's cut-off, in business days? Past or far away is null. */
export function cutoffStage(cutoff: Date | null, businessDate: Date): "TODAY" | "TOMORROW" | null {
  if (!cutoff) return null
  const days = Math.round((Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth(), cutoff.getUTCDate()) - Date.UTC(businessDate.getUTCFullYear(), businessDate.getUTCMonth(), businessDate.getUTCDate())) / 86_400_000)
  return days === 0 ? "TODAY" : days === 1 ? "TOMORROW" : null
}

/** Pure: has a shift been open long enough to count as forgotten? */
export function shiftLeftOpen(openedAt: Date, now: Date): boolean {
  return now.getTime() - openedAt.getTime() >= SHIFT_OPEN_HOURS * 3_600_000
}

type Property = { id: string; name: string; businessDate: Date | null; enterprise: { slug: string } }

async function activeProperties(enterpriseId: string): Promise<Property[]> {
  return prisma.property.findMany({
    where: { enterpriseId, status: "ACTIVE" },
    select: { id: true, name: true, businessDate: true, enterprise: { select: { slug: true } } },
  })
}

/** Transfers in the next two days whose attention warnings are new (or whose flight changed). */
export async function scanTransportAttention(enterpriseId: string): Promise<number> {
  const addon = await prisma.enterpriseAddonAccess.findUnique({ where: { enterpriseId_module: { enterpriseId, module: "TRANSPORTATION" } } })
  if (!addon?.enabled) return 0
  let raised = 0
  for (const p of await activeProperties(enterpriseId)) {
    const settings = await prisma.transportSettings.findUnique({ where: { propertyId: p.id }, select: { enabled: true } })
    if (!settings?.enabled) continue
    const today = dateToKey(resolveBusinessDate(p))
    const { items } = await listBookings(p.id, { from: today, to: addDaysKey(today, TRANSPORT_LOOKAHEAD_DAYS), attentionOnly: true })
    for (const b of items) {
      const codes = b.attention.map((a) => a.code).sort().join("+")
      // A new warning, or the same warning after the flight time moved, is a new alert.
      const id = await notify({
        type: "TRANSPORT_ATTENTION",
        enterpriseId,
        propertyId: p.id,
        title: "A transfer needs attention",
        body: `${p.name}: ${b.reference}, ${b.attention[0]?.message ?? "check the booking"}`.slice(0, 300),
        url: `/e/${p.enterprise.slug}/dashboard/transportation`,
        entityType: "TransportBooking",
        entityId: b.id,
        dedupeKey: `TRANSPORT_ATTENTION:${b.id}:${codes}:${b.flightAt ?? ""}`,
        audience: { need: { module: "TRANSPORTATION", action: "update" } },
      })
      if (id) raised += 1
    }
  }
  return raised
}

/** Cashier shifts open for over 16 hours: the cashier, and the people who supervise cashiering. */
export async function scanOpenShifts(enterpriseId: string, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SHIFT_OPEN_HOURS * 3_600_000)
  const shifts = await prisma.cashierShift.findMany({
    where: { enterpriseId, closedAt: null, openedAt: { lte: cutoff }, propertyId: { not: null } },
    select: { id: true, userId: true, propertyId: true, openedAt: true, businessDate: true },
  })
  const props = new Map((await activeProperties(enterpriseId)).map((p) => [p.id, p]))
  let raised = 0
  for (const s of shifts) {
    const p = s.propertyId ? props.get(s.propertyId) : undefined
    if (!p) continue
    const url = `/e/${p.enterprise.slug}/dashboard/cashiering`
    const base = { type: "CASHIER_SHIFT_OPEN" as const, enterpriseId, propertyId: p.id, url, entityType: "CashierShift", entityId: s.id }
    // Once per shift per day it stays open.
    const day = now.toISOString().slice(0, 10)
    const own = await notify({
      ...base,
      title: "Your cashier shift is still open",
      body: `${p.name}: opened over ${SHIFT_OPEN_HOURS} hours ago. Close it when you are done.`,
      dedupeKey: `CASHIER_SHIFT_OPEN:own:${s.id}:${day}`,
      audience: { userIds: [s.userId] },
    })
    const sup = await notify({
      ...base,
      title: "A cashier shift has been left open",
      body: `${p.name}: open for over ${SHIFT_OPEN_HOURS} hours.`,
      dedupeKey: `CASHIER_SHIFT_OPEN:sup:${s.id}:${day}`,
      audience: { need: { module: "CASHIERING", action: "update" } },
      excludeUserId: s.userId,
    })
    if (own || sup) raised += 1
  }
  return raised
}

/** Groups whose cut-off is today or tomorrow and still have rooms held that nobody picked up. */
export async function scanGroupCutoffs(enterpriseId: string): Promise<number> {
  let raised = 0
  for (const p of await activeProperties(enterpriseId)) {
    const businessDate = resolveBusinessDate(p)
    const tomorrow = new Date(businessDate.getTime() + 86_400_000)
    const groups = await prisma.groupBlock.findMany({
      where: { propertyId: p.id, status: { in: ["TENTATIVE", "DEFINITE"] }, cutoffDate: { gte: businessDate, lte: tomorrow } },
      select: { id: true, code: true, name: true, cutoffDate: true, roomHolds: { select: { quantity: true } } },
    })
    for (const g of groups) {
      const stage = cutoffStage(g.cutoffDate, businessDate)
      if (!stage) continue
      const held = g.roomHolds.reduce((n, r) => n + r.quantity, 0)
      const pickedUp = await prisma.reservation.count({
        where: { groupBlockId: g.id, isPostingMaster: false, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
      })
      const outstanding = held - pickedUp
      if (outstanding <= 0) continue
      const id = await notify({
        type: "GROUP_CUTOFF",
        enterpriseId,
        propertyId: p.id,
        title: stage === "TODAY" ? "A group's cut-off date is today" : "A group's cut-off date is tomorrow",
        body: `${p.name}: ${g.code} ${g.name}, ${outstanding} of ${held} rooms not picked up.`.slice(0, 300),
        url: `/e/${p.enterprise.slug}/dashboard/groups`,
        entityType: "GroupBlock",
        entityId: g.id,
        dedupeKey: `GROUP_CUTOFF:${g.id}:${stage}:${dateToKey(g.cutoffDate!)}`,
        audience: { need: { module: "GROUP_BLOCKS", action: "update" } },
      })
      if (id) raised += 1
    }
  }
  return raised
}
