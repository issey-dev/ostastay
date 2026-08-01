import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { getRowCounts, getMigrationStatus, getDbFileSizeBytes, getStorageStats } from "@/lib/db-health";
import {
  getQueryStats,
  getSlowestQueries,
  getRecentEngineEvents,
  getBufferInfo,
  getTenantOpStats,
  getModelOpBufferInfo,
} from "@/lib/db-metrics";

// Channel-manager API health, aggregated from the persisted ChannelSyncLog (unlike the
// in-memory DB metrics, this survives restarts and is a real cross-instance record).
// Window: last 7 days, capped — aggregation happens in JS because SQLite + Prisma
// groupBy can't produce the per-operation percentile-ish shape we want in one query,
// and 5000 rows is nothing at this scale.
async function getChannelApiStats() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const logs = await prisma.channelSyncLog.findMany({
    where: { createdAt: { gte: since } },
    select: {
      enterpriseId: true,
      connectionName: true,
      direction: true,
      operation: true,
      ok: true,
      httpStatus: true,
      latencyMs: true,
      createdAt: true,
      errorMessage: true,
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

  type OpAgg = {
    enterpriseId: string;
    operation: string;
    direction: string;
    count: number;
    failures: number;
    totalLatency: number;
    latencyCount: number;
    maxLatency: number;
  };
  const byOp = new Map<string, OpAgg>();
  for (const l of logs) {
    const key = `${l.enterpriseId}|${l.operation}|${l.direction}`;
    const g = byOp.get(key) ?? {
      enterpriseId: l.enterpriseId,
      operation: l.operation,
      direction: l.direction,
      count: 0,
      failures: 0,
      totalLatency: 0,
      latencyCount: 0,
      maxLatency: 0,
    };
    g.count += 1;
    if (!l.ok) g.failures += 1;
    if (l.latencyMs !== null) {
      g.totalLatency += l.latencyMs;
      g.latencyCount += 1;
      g.maxLatency = Math.max(g.maxLatency, l.latencyMs);
    }
    byOp.set(key, g);
  }

  const last24h = Date.now() - 24 * 60 * 60 * 1000;
  return {
    windowDays: 7,
    truncated: logs.length === 5000,
    totals: {
      calls: logs.length,
      failures: logs.filter((l) => !l.ok).length,
      calls24h: logs.filter((l) => l.createdAt.getTime() >= last24h).length,
      failures24h: logs.filter((l) => !l.ok && l.createdAt.getTime() >= last24h).length,
    },
    byOperation: Array.from(byOp.values())
      .map((g) => ({
        enterpriseId: g.enterpriseId,
        operation: g.operation,
        direction: g.direction,
        count: g.count,
        failures: g.failures,
        avgLatencyMs: g.latencyCount > 0 ? Math.round(g.totalLatency / g.latencyCount) : null,
        maxLatencyMs: g.latencyCount > 0 ? g.maxLatency : null,
      }))
      .sort((a, b) => b.count - a.count),
    recentFailures: logs
      .filter((l) => !l.ok)
      .slice(0, 15)
      .map((l) => ({
        enterpriseId: l.enterpriseId,
        connectionName: l.connectionName,
        operation: l.operation,
        httpStatus: l.httpStatus,
        errorMessage: l.errorMessage,
        createdAt: l.createdAt,
      })),
  };
}

// Background-job health from the persisted JobRun table: last run per (enterprise,
// job) plus 7-day failure counts.
async function getJobStats() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const runs = await prisma.jobRun.findMany({
    where: { startedAt: { gte: since } },
    orderBy: { startedAt: "desc" },
    take: 1000,
    select: {
      enterpriseId: true,
      jobName: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      itemsProcessed: true,
      error: true,
    },
  });

  type JobAgg = {
    enterpriseId: string;
    jobName: string;
    runs: number;
    failures: number;
    lastStatus: string;
    lastStartedAt: Date;
    lastDurationMs: number | null;
    lastError: string | null;
  };
  const byJob = new Map<string, JobAgg>();
  for (const r of runs) {
    const key = `${r.enterpriseId}|${r.jobName}`;
    const existing = byJob.get(key);
    if (existing) {
      existing.runs += 1;
      if (r.status === "FAILED") existing.failures += 1;
      continue;
    }
    byJob.set(key, {
      enterpriseId: r.enterpriseId,
      jobName: r.jobName,
      runs: 1,
      failures: r.status === "FAILED" ? 1 : 0,
      lastStatus: r.status,
      lastStartedAt: r.startedAt,
      lastDurationMs: r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
      lastError: r.error,
    });
  }
  return Array.from(byJob.values()).sort((a, b) => b.lastStartedAt.getTime() - a.lastStartedAt.getTime());
}

export async function GET() {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can view database health");
    }
    requirePermission(ctx, "CONTROLS", "view");

    const [rowCounts, migrationStatus, storage, channelApi, jobs, enterprises, properties] = await Promise.all([
      getRowCounts(),
      getMigrationStatus(),
      getStorageStats(),
      getChannelApiStats(),
      getJobStats(),
      prisma.enterprise.findMany({ select: { id: true, name: true, type: true }, orderBy: { name: "asc" } }),
      prisma.property.findMany({ select: { id: true, name: true, enterpriseId: true }, orderBy: { name: "asc" } }),
    ]);

    return NextResponse.json({
      rowCounts,
      migrationStatus,
      dbFileSizeBytes: getDbFileSizeBytes(),
      storage,
      queryStats: getQueryStats(),
      slowestQueries: getSlowestQueries(20),
      recentEngineEvents: getRecentEngineEvents(20),
      bufferInfo: getBufferInfo(),
      tenantOps: getTenantOpStats(),
      tenantOpsBufferInfo: getModelOpBufferInfo(),
      channelApi,
      jobs,
      enterprises,
      properties,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
