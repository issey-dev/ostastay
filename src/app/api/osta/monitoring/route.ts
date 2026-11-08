import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { MANAGED_BY, CONNECTION_STATUS } from "@/lib/channels/connection";
import { getSlowestQueries, getTenantOpStats } from "@/lib/db-metrics";
import { p95FromHist } from "@/lib/db-rollups";

// The Osta Monitoring page's Overview (src/components/osta/monitoring/…): one call returns
// the charts, key figures, per-enterprise (or per-property) table and "worth a look" items
// for a time range and scope. Load comes from the per-minute DbMetricRollup table, channel
// calls from ChannelSyncLog (Uppsolut-run connections only: an enterprise's own is just
// running / not running, DECISIONS.md 2026-11-07), jobs from JobRun. Osta staff only.

const RANGES = {
  "1h": { spanMs: 60 * 60_000, bucketMs: 60_000 },
  "24h": { spanMs: 24 * 60 * 60_000, bucketMs: 15 * 60_000 },
  "7d": { spanMs: 7 * 24 * 60 * 60_000, bucketMs: 2 * 60 * 60_000 },
} as const;
type RangeKey = keyof typeof RANGES;

const TOP_SERIES = 4;
const NONE = "__none__";

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) throw new ForbiddenError("Only Osta staff can view monitoring");
    requirePermission(ctx, "CONTROLS", "view");

    const sp = new URL(request.url).searchParams;
    const range: RangeKey = (sp.get("range") as RangeKey) in RANGES ? (sp.get("range") as RangeKey) : "24h";
    const enterpriseId = sp.get("enterprise") || null;
    const propertyId = enterpriseId ? sp.get("property") || null : null;
    const { spanMs, bucketMs } = RANGES[range];
    const secs = bucketMs / 1000;

    const now = Date.now();
    // Whole buckets, ending with the one in progress.
    const lastBucket = now - (now % bucketMs);
    const count = Math.round(spanMs / bucketMs);
    const firstBucket = lastBucket - (count - 1) * bucketMs;
    const from = new Date(firstBucket);
    const prevFrom = new Date(firstBucket - spanMs);
    const buckets = Array.from({ length: count }, (_, i) => firstBucket + i * bucketMs);
    const idx = (b: number) => Math.round((b * 1000 - firstBucket) / bucketMs);

    // What the series and table are split by: enterprises, then an enterprise's properties.
    const keyCol = propertyId ? Prisma.sql`'all'` : enterpriseId ? Prisma.sql`COALESCE("propertyId", ${NONE})` : Prisma.sql`COALESCE("enterpriseId", ${NONE})`;
    const scopeSql = Prisma.sql`${enterpriseId ? Prisma.sql`AND "enterpriseId" = ${enterpriseId}` : Prisma.empty} ${propertyId ? Prisma.sql`AND "propertyId" = ${propertyId}` : Prisma.empty}`;

    const [enterprises, seriesRows, keyHistRows, bucketHistRows, prevRows, channelRows, ownConnections, jobRows, sizeRows] = await Promise.all([
      prisma.enterprise.findMany({
        select: { id: true, name: true, type: true, properties: { select: { id: true, name: true, code: true }, orderBy: { name: "asc" } } },
        orderBy: { name: "asc" },
      }),
      prisma.$queryRaw<{ b: bigint; k: string; ops: number; total: number; errors: number; warnings: number }[]>`
        SELECT floor(extract(epoch from "bucketStart") / ${secs})::bigint * ${secs} AS b, ${keyCol} AS k,
               sum(ops)::int AS ops, sum("totalMs")::float8 AS total,
               sum("engineErrors")::int AS errors, sum("engineWarnings")::int AS warnings
        FROM "DbMetricRollup" WHERE "bucketStart" >= ${from} ${scopeSql}
        GROUP BY 1, 2`,
      prisma.$queryRaw<{ k: string; i: number; v: number }[]>`
        SELECT ${keyCol} AS k, u.i::int AS i, sum(u.v)::int AS v
        FROM "DbMetricRollup", unnest("latencyHist") WITH ORDINALITY AS u(v, i)
        WHERE "bucketStart" >= ${from} ${scopeSql}
        GROUP BY 1, 2`,
      prisma.$queryRaw<{ b: bigint; i: number; v: number }[]>`
        SELECT floor(extract(epoch from "bucketStart") / ${secs})::bigint * ${secs} AS b, u.i::int AS i, sum(u.v)::int AS v
        FROM "DbMetricRollup", unnest("latencyHist") WITH ORDINALITY AS u(v, i)
        WHERE "bucketStart" >= ${from} ${scopeSql}
        GROUP BY 1, 2`,
      prisma.$queryRaw<{ ops: number | null }[]>`
        SELECT sum(ops)::int AS ops FROM "DbMetricRollup"
        WHERE "bucketStart" >= ${prevFrom} AND "bucketStart" < ${from} ${scopeSql}`,
      prisma.$queryRaw<{ b: bigint; e: string; calls: number; fails: number }[]>`
        SELECT floor(extract(epoch from l."createdAt") / ${secs})::bigint * ${secs} AS b,
               ${propertyId || enterpriseId ? Prisma.sql`COALESCE(l."propertyId", ${NONE})` : Prisma.sql`l."enterpriseId"`} AS e,
               count(*)::int AS calls, (count(*) FILTER (WHERE NOT l.ok))::int AS fails
        FROM "ChannelSyncLog" l JOIN "ChannelConnection" c ON c.id = l."connectionId"
        WHERE c."managedBy" = ${MANAGED_BY.OSTA} AND l."createdAt" >= ${from}
          ${enterpriseId ? Prisma.sql`AND l."enterpriseId" = ${enterpriseId}` : Prisma.empty}
          ${propertyId ? Prisma.sql`AND l."propertyId" = ${propertyId}` : Prisma.empty}
        GROUP BY 1, 2`,
      prisma.channelConnection.findMany({
        where: { managedBy: MANAGED_BY.ENTERPRISE, ...(enterpriseId ? { enterpriseId } : {}), ...(propertyId ? { propertyId } : {}) },
        select: { enterpriseId: true, propertyId: true, status: true },
      }),
      // Jobs run per enterprise (JobRun has no property).
      prisma.jobRun.groupBy({
        by: ["enterpriseId", "status"],
        where: { startedAt: { gte: from }, ...(enterpriseId ? { enterpriseId } : {}) },
        _count: { _all: true },
      }),
      prisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database())::bigint AS size`,
    ]);

    // ── Names ────────────────────────────────────────────────────────────────
    const entName = new Map(enterprises.map((e) => [e.id, e.type === "INTERNAL" ? `${e.name} (internal)` : e.name]));
    const scopedEnterprise = enterpriseId ? enterprises.find((e) => e.id === enterpriseId) ?? null : null;
    const propName = new Map(enterprises.flatMap((e) => e.properties.map((p) => [p.id, p.name] as const)));
    const label = (k: string) =>
      propertyId ? propName.get(propertyId) ?? "This property"
      : enterpriseId ? (k === NONE ? "Enterprise-wide" : propName.get(k) ?? "Removed property")
      : k === NONE ? "Sign-in, public pages & system" : entName.get(k) ?? "Removed enterprise";

    // ── Load series ──────────────────────────────────────────────────────────
    const byKey = new Map<string, { ops: number[]; total: number }>();
    const opsSpark = new Array(count).fill(0);
    const errSpark = new Array(count).fill(0);
    let engineErrors = 0;
    let engineWarnings = 0;
    let totalMs = 0;
    for (const r of seriesRows) {
      const i = idx(Number(r.b));
      if (i < 0 || i >= count) continue;
      const e = byKey.get(r.k) ?? { ops: new Array(count).fill(0), total: 0 };
      e.ops[i] += r.ops;
      e.total += r.total;
      byKey.set(r.k, e);
      opsSpark[i] += r.ops;
      errSpark[i] += r.errors;
      engineErrors += r.errors;
      engineWarnings += r.warnings;
      totalMs += r.total;
    }
    const ops = opsSpark.reduce((a, b) => a + b, 0);

    const keyHist = new Map<string, number[]>();
    for (const r of keyHistRows) {
      const h = keyHist.get(r.k) ?? new Array(9).fill(0);
      h[r.i - 1] += r.v;
      keyHist.set(r.k, h);
    }
    const allHist = new Array(9).fill(0);
    const bucketHist = new Map<number, number[]>();
    for (const r of bucketHistRows) {
      const i = idx(Number(r.b));
      if (i < 0 || i >= count) continue;
      const h = bucketHist.get(i) ?? new Array(9).fill(0);
      h[r.i - 1] += r.v;
      bucketHist.set(i, h);
      allHist[r.i - 1] += r.v;
    }
    const p95Spark = buckets.map((_, i) => (bucketHist.has(i) ? p95FromHist(bucketHist.get(i)!) : null));

    // Top series by volume, the rest folded into "Other".
    const ranked = [...byKey.entries()].sort((a, b) => b[1].ops.reduce((x, y) => x + y, 0) - a[1].ops.reduce((x, y) => x + y, 0));
    const series = ranked.slice(0, TOP_SERIES).map(([k, v]) => ({ key: k, label: label(k), values: v.ops }));
    if (ranked.length > TOP_SERIES) {
      const rest = new Array(count).fill(0);
      for (const [, v] of ranked.slice(TOP_SERIES)) v.ops.forEach((n, i) => (rest[i] += n));
      series.push({ key: "__other__", label: `Other ${ranked.length - TOP_SERIES}`, values: rest });
    }

    // ── Channel (Uppsolut-run) and own connections ───────────────────────────
    const chanByKey = new Map<string, { calls: number; fails: number }>();
    const chanFailSpark = new Array(count).fill(0);
    let channelCalls = 0;
    let channelFailures = 0;
    for (const r of channelRows) {
      const c = chanByKey.get(r.e) ?? { calls: 0, fails: 0 };
      c.calls += r.calls;
      c.fails += r.fails;
      chanByKey.set(r.e, c);
      channelCalls += r.calls;
      channelFailures += r.fails;
      const i = idx(Number(r.b));
      if (i >= 0 && i < count) chanFailSpark[i] += r.fails;
    }
    const ownByKey = new Map<string, boolean>();
    for (const c of ownConnections) {
      const k = enterpriseId ? c.propertyId : c.enterpriseId;
      ownByKey.set(k, (ownByKey.get(k) ?? true) && c.status === CONNECTION_STATUS.CONNECTED);
    }

    // ── Jobs ─────────────────────────────────────────────────────────────────
    const jobsByEnt = new Map<string, { runs: number; failures: number }>();
    let jobRuns = 0;
    let jobFailures = 0;
    for (const r of jobRows) {
      const j = jobsByEnt.get(r.enterpriseId) ?? { runs: 0, failures: 0 };
      j.runs += r._count._all;
      if (r.status === "FAILED") j.failures += r._count._all;
      jobsByEnt.set(r.enterpriseId, j);
      jobRuns += r._count._all;
      if (r.status === "FAILED") jobFailures += r._count._all;
    }

    // ── Table rows ───────────────────────────────────────────────────────────
    // Every customer enterprise (or every property of the scoped one) is listed, busy or not.
    const rowKeys = new Set<string>(byKey.keys());
    if (!enterpriseId) enterprises.filter((e) => e.type === "STANDARD").forEach((e) => rowKeys.add(e.id));
    else if (!propertyId) scopedEnterprise?.properties.forEach((p) => rowKeys.add(p.id));
    const rows = propertyId
      ? []
      : [...rowKeys].map((k) => {
          const h = keyHist.get(k);
          const v = byKey.get(k);
          const kOps = v ? v.ops.reduce((a, b) => a + b, 0) : 0;
          const own = ownByKey.get(k);
          const chan = chanByKey.get(k);
          return {
            key: k,
            label: label(k),
            scopeable: k !== NONE,
            ops: kOps,
            avgMs: kOps ? Math.round((v!.total / kOps) * 10) / 10 : null,
            p95: h ? p95FromHist(h) : null,
            spark: v ? v.ops : new Array(count).fill(0),
            channel: chan ? { kind: "osta" as const, calls: chan.calls, failures: chan.fails } : own !== undefined ? { kind: "enterprise" as const, running: own } : null,
            jobs: enterpriseId ? null : jobsByEnt.get(k) ?? null,
          };
        }).sort((a, b) => b.ops - a.ops);

    // ── Worth a look ─────────────────────────────────────────────────────────
    const attention: { tone: "warning" | "danger"; tag: string; text: string; scope?: { enterprise: string; property?: string } }[] = [];
    if (engineErrors > 0) attention.push({ tone: "danger", tag: "Engine", text: `${engineErrors} database engine error${engineErrors === 1 ? "" : "s"} in this range` });
    for (const r of rows) {
      if (r.ops >= 50 && r.p95 !== null && r.p95 >= 250)
        attention.push({ tone: "warning", tag: "Slow", text: `${r.label}: 95% of operations took up to ${r.p95} ms`, scope: r.scopeable ? (enterpriseId ? { enterprise: enterpriseId, property: r.key } : { enterprise: r.key }) : undefined });
      if (r.channel?.kind === "osta" && r.channel.failures > 0)
        attention.push({ tone: "danger", tag: "API", text: `${r.channel.failures} of ${r.channel.calls} channel-manager calls failed for ${r.label} (Uppsolut-run)` });
      if (r.jobs && r.jobs.failures > 0)
        attention.push({ tone: "danger", tag: "Jobs", text: `${r.jobs.failures} background job run${r.jobs.failures === 1 ? "" : "s"} failed for ${r.label}` });
    }

    // Property scope: what that property runs, from the live buffer (rollups keep no model names).
    const liveOps = propertyId
      ? getTenantOpStats()
          .filter((r) => r.propertyId === propertyId)
          .slice(0, 12)
          .map((r) => ({ name: `${r.model}.${r.operation}`, count: r.count, avgMs: r.avgMs, maxMs: r.maxMs }))
      : [];

    return NextResponse.json({
      range,
      bucketMs,
      buckets,
      scope: {
        enterpriseId,
        propertyId,
        enterpriseName: scopedEnterprise ? entName.get(scopedEnterprise.id) : null,
        propertyName: propertyId ? propName.get(propertyId) ?? null : null,
      },
      series,
      kpis: {
        ops,
        opsPrev: prevRows[0]?.ops ?? 0,
        avgMs: ops ? Math.round((totalMs / ops) * 10) / 10 : null,
        p95: p95FromHist(allHist),
        engineErrors: enterpriseId ? null : engineErrors,
        engineWarnings: enterpriseId ? null : engineWarnings,
        channelCalls,
        channelFailures,
        jobRuns,
        jobFailures,
        dbSizeBytes: Number(sizeRows[0]?.size ?? 0),
        opsSpark,
        p95Spark,
        errSpark,
        chanFailSpark,
      },
      rows,
      liveOps,
      attention,
      // SQL text carries no tenant, so the slowest-statements list is platform-wide only.
      slowQueries: enterpriseId ? [] : getSlowestQueries(5).map((q) => ({ ms: Math.round(q.duration), query: q.query })),
      picker: enterprises.map((e) => ({
        id: e.id,
        name: entName.get(e.id)!,
        internal: e.type === "INTERNAL",
        properties: e.properties,
      })),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
