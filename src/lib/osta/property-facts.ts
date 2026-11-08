import { prisma } from "@/lib/db"
import { toUtcMidnight } from "@/lib/business-date"

// What the Osta console knows about a property's SETUP and HEALTH, never its guests or
// people (owner, 2026-11-07: people and activity trails are classified for Osta). All
// counts are aggregates; "last activity" is a timestamp and a kind only, no actor.

const DAY = 86_400_000

export type BusinessDateState = "OK" | "BEHIND" | "AHEAD" | "UNSET"

export type PropertyFacts = {
  rooms: number
  roomTypes: number
  maxRooms: number | null
  maxRoomTypes: number | null
  /** Rooms out of order or out of service right now. */
  roomsOffline: number
  /** YYYY-MM-DD, or null when the property never had one set. */
  businessDate: string | null
  /** The wall-clock date at the property (its own time zone), YYYY-MM-DD. */
  localToday: string
  businessDateState: BusinessDateState
  /** Whole days the business date trails (positive) or leads (negative) the local date. */
  businessDateLagDays: number
  eodInProgress: boolean
  lastAudit: { date: string; at: string; status: string } | null
  lastActivity: { at: string; kind: string } | null
  inHouse: number
  arrivals: number
  departures: number
}

/** The calendar date in `timeZone` as YYYY-MM-DD (falls back to UTC on a bad zone). */
export function localDateIn(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

const ymd = (d: Date) => toUtcMidnight(d).toISOString().slice(0, 10)

export async function getPropertyFacts(
  properties: { id: string; timeZone: string; businessDate: Date | null }[],
  now = new Date()
): Promise<Map<string, PropertyFacts>> {
  const ids = properties.map((p) => p.id)
  const out = new Map<string, PropertyFacts>()
  if (ids.length === 0) return out

  const physical = { roomType: { isPseudo: false } }
  const [rooms, offline, types, allowances, eods, audits, lastRes, lastPost, lastEod, inHouse, resByDate] = await Promise.all([
    prisma.room.groupBy({ by: ["propertyId"], where: { propertyId: { in: ids }, ...physical }, _count: { _all: true } }),
    prisma.room.groupBy({
      by: ["propertyId"],
      where: { propertyId: { in: ids }, ...physical, status: { in: ["OUT_OF_ORDER", "OUT_OF_SERVICE"] } },
      _count: { _all: true },
    }),
    prisma.roomType.groupBy({ by: ["propertyId"], where: { propertyId: { in: ids }, isActive: true, isPseudo: false }, _count: { _all: true } }),
    prisma.propertyLicenseAllowance.findMany({ where: { propertyId: { in: ids } }, select: { propertyId: true, maxRooms: true, maxRoomTypes: true } }),
    prisma.eodRun.findMany({ where: { propertyId: { in: ids }, status: "IN_PROGRESS" }, select: { propertyId: true } }),
    prisma.propertyNightAuditLog.findMany({
      where: { propertyId: { in: ids } },
      orderBy: { executedAt: "desc" },
      distinct: ["propertyId"],
      select: { propertyId: true, auditDate: true, executedAt: true, status: true },
    }),
    prisma.reservation.groupBy({ by: ["propertyId"], where: { propertyId: { in: ids } }, _max: { updatedAt: true } }),
    prisma.$queryRaw<{ propertyId: string; at: Date | null }[]>`
      SELECT f."propertyId", MAX(li."createdAt") AS at
      FROM "FolioLineItem" li JOIN "Folio" f ON f.id = li."folioId"
      WHERE f."propertyId" = ANY(${ids})
      GROUP BY f."propertyId"`,
    prisma.eodRun.groupBy({ by: ["propertyId"], where: { propertyId: { in: ids } }, _max: { startedAt: true } }),
    prisma.reservation.groupBy({
      by: ["propertyId"],
      where: { propertyId: { in: ids }, status: "IN_HOUSE", isPostingMaster: false },
      _count: { _all: true },
    }),
    // Arrivals/departures are on the property's business date; fetched for the union of
    // those dates and split per property below.
    prisma.reservation.findMany({
      where: {
        propertyId: { in: ids },
        isPostingMaster: false,
        OR: [
          { status: "RESERVED", checkInDate: { in: properties.map((p) => toUtcMidnight(p.businessDate ?? now)) } },
          { status: "IN_HOUSE", checkOutDate: { in: properties.map((p) => toUtcMidnight(p.businessDate ?? now)) } },
        ],
      },
      select: { propertyId: true, status: true, checkInDate: true, checkOutDate: true },
    }),
  ])

  const count = (rows: { propertyId: string; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.propertyId, r._count._all]))
  const roomsBy = count(rooms)
  const offlineBy = count(offline)
  const typesBy = count(types)
  const inHouseBy = count(inHouse)
  const allowBy = new Map(allowances.map((a) => [a.propertyId, a]))
  const eodBy = new Set(eods.map((e) => e.propertyId))
  const auditBy = new Map(audits.map((a) => [a.propertyId, a]))

  // Last activity: the newest of a booking change, a folio posting or a Night Audit start.
  const latest = new Map<string, { at: Date; kind: string }>()
  const bump = (id: string, at: Date | null | undefined, kind: string) => {
    if (!at) return
    const cur = latest.get(id)
    if (!cur || at > cur.at) latest.set(id, { at, kind })
  }
  for (const r of lastRes) bump(r.propertyId, r._max.updatedAt, "Booking change")
  for (const f of lastPost) bump(f.propertyId, f.at, "Folio posting")
  for (const e of lastEod) bump(e.propertyId, e._max.startedAt, "Night Audit")

  for (const p of properties) {
    const localToday = localDateIn(p.timeZone, now)
    const bd = p.businessDate ? ymd(p.businessDate) : null
    const lag = bd ? Math.round((Date.parse(`${localToday}T00:00:00Z`) - Date.parse(`${bd}T00:00:00Z`)) / DAY) : 0
    const bdMs = toUtcMidnight(p.businessDate ?? now).getTime()
    const audit = auditBy.get(p.id)
    const act = latest.get(p.id)
    out.set(p.id, {
      rooms: roomsBy.get(p.id) ?? 0,
      roomTypes: typesBy.get(p.id) ?? 0,
      maxRooms: allowBy.get(p.id)?.maxRooms ?? null,
      maxRoomTypes: allowBy.get(p.id)?.maxRoomTypes ?? null,
      roomsOffline: offlineBy.get(p.id) ?? 0,
      businessDate: bd,
      localToday,
      businessDateState: !bd ? "UNSET" : lag > 0 ? "BEHIND" : lag < 0 ? "AHEAD" : "OK",
      businessDateLagDays: lag,
      eodInProgress: eodBy.has(p.id),
      lastAudit: audit ? { date: ymd(audit.auditDate), at: audit.executedAt.toISOString(), status: audit.status } : null,
      lastActivity: act ? { at: act.at.toISOString(), kind: act.kind } : null,
      inHouse: inHouseBy.get(p.id) ?? 0,
      arrivals: resByDate.filter((r) => r.propertyId === p.id && r.status === "RESERVED" && r.checkInDate.getTime() === bdMs).length,
      departures: resByDate.filter((r) => r.propertyId === p.id && r.status === "IN_HOUSE" && r.checkOutDate.getTime() === bdMs).length,
    })
  }
  return out
}
