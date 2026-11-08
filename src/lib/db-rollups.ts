// Per-minute rollups of database load (the DbMetricRollup table), so the Osta Monitoring
// page can chart 1h / 24h / 7d rather than only the since-restart ring buffers in
// db-metrics.ts (owner, 2026-11-07).
//
// Every model operation and engine event is added to an in-memory bucket for its minute
// and (enterprise, property). A completed minute is written in one createMany. There is no
// interval: the first event after a write schedules the next flush ~a minute later, so an
// idle server writes nothing and wakes for nothing. Each instance writes its own rows and
// readers SUM them; a crash loses at most the unflushed minute or two, which is fine for
// a monitoring chart.

/** Upper edges (ms) of the latency bands; the last band is everything slower. */
export const LATENCY_EDGES_MS = [5, 10, 25, 50, 100, 250, 500, 1000] as const
const BANDS = LATENCY_EDGES_MS.length + 1

const MINUTE = 60_000
const RETAIN_MS = 8 * 24 * 60 * MINUTE
const PRUNE_EVERY_MS = 60 * MINUTE
/** The rollup writes themselves are model operations — never count them. */
export const ROLLUP_MODEL = "DbMetricRollup"

type Bucket = {
  bucketStart: number
  enterpriseId: string | null
  propertyId: string | null
  ops: number
  totalMs: number
  maxMs: number
  hist: number[]
  engineErrors: number
  engineWarnings: number
}

const g = globalThis as unknown as {
  __dbRollupBuckets?: Map<string, Bucket>
  __dbRollupTimer?: ReturnType<typeof setTimeout> | null
  __dbRollupLastPrune?: number
}
const buckets = g.__dbRollupBuckets ?? (g.__dbRollupBuckets = new Map())

function bucketFor(at: number, enterpriseId: string | null, propertyId: string | null): Bucket {
  const bucketStart = at - (at % MINUTE)
  const key = `${bucketStart}|${enterpriseId ?? ""}|${propertyId ?? ""}`
  let b = buckets.get(key)
  if (!b) {
    b = { bucketStart, enterpriseId, propertyId, ops: 0, totalMs: 0, maxMs: 0, hist: new Array(BANDS).fill(0), engineErrors: 0, engineWarnings: 0 }
    buckets.set(key, b)
  }
  scheduleFlush()
  return b
}

export function rollupModelOp(model: string, duration: number, enterpriseId: string | null, propertyId: string | null) {
  if (model === ROLLUP_MODEL) return
  const b = bucketFor(Date.now(), enterpriseId, propertyId)
  b.ops += 1
  b.totalMs += duration
  b.maxMs = Math.max(b.maxMs, duration)
  let band = LATENCY_EDGES_MS.findIndex((edge) => duration <= edge)
  if (band === -1) band = BANDS - 1
  b.hist[band] += 1
}

export function rollupEngineEvent(level: "error" | "warn", at: number) {
  const b = bucketFor(at, null, null)
  if (level === "error") b.engineErrors += 1
  else b.engineWarnings += 1
}

function scheduleFlush() {
  if (g.__dbRollupTimer) return
  // Lands just after the next minute boundary, when the current minute is complete.
  const wait = MINUTE - (Date.now() % MINUTE) + 2_000
  g.__dbRollupTimer = setTimeout(() => {
    g.__dbRollupTimer = null
    void flush()
  }, wait)
  // Never keep a process (or a test run) alive just to write metrics.
  g.__dbRollupTimer.unref?.()
}

async function flush() {
  const current = Date.now() - (Date.now() % MINUTE)
  const done: Bucket[] = []
  for (const [key, b] of buckets) {
    if (b.bucketStart < current) {
      done.push(b)
      buckets.delete(key)
    }
  }
  // Events still arriving for the current minute re-schedule through bucketFor.
  if (buckets.size > 0) scheduleFlush()
  if (done.length === 0) return
  try {
    // Imported here, not at the top: db.ts imports this module's caller (db-metrics.ts).
    const { prisma } = await import("@/lib/db")
    await prisma.dbMetricRollup.createMany({
      data: done.map((b) => ({
        bucketStart: new Date(b.bucketStart),
        enterpriseId: b.enterpriseId,
        propertyId: b.propertyId,
        ops: b.ops,
        totalMs: Math.round(b.totalMs * 10) / 10,
        maxMs: Math.round(b.maxMs * 10) / 10,
        latencyHist: b.hist,
        engineErrors: b.engineErrors,
        engineWarnings: b.engineWarnings,
      })),
    })
    const now = Date.now()
    if (now - (g.__dbRollupLastPrune ?? 0) > PRUNE_EVERY_MS) {
      g.__dbRollupLastPrune = now
      await prisma.dbMetricRollup.deleteMany({ where: { bucketStart: { lt: new Date(now - RETAIN_MS) } } })
    }
  } catch {
    // Metrics are best-effort: a failed write drops those minutes, never a request.
  }
}

/** p95 (ms, band upper edge) from summed band counts; null without data. */
export function p95FromHist(hist: number[]): number | null {
  const total = hist.reduce((a, b) => a + b, 0)
  if (total === 0) return null
  const target = total * 0.95
  let seen = 0
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i]
    if (seen >= target) return i < LATENCY_EDGES_MS.length ? LATENCY_EDGES_MS[i] : LATENCY_EDGES_MS[LATENCY_EDGES_MS.length - 1] * 2
  }
  return null
}
