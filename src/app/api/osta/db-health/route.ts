import { NextResponse } from "next/server";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { getRowCounts, getMigrationStatus, getDbFileSizeBytes } from "@/lib/db-health";
import { getQueryStats, getSlowestQueries, getRecentEngineEvents, getBufferInfo } from "@/lib/db-metrics";

export async function GET() {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can view database health");
    }
    requirePermission(ctx, "CONTROLS", "view");

    const [rowCounts, migrationStatus] = await Promise.all([getRowCounts(), getMigrationStatus()]);

    return NextResponse.json({
      rowCounts,
      migrationStatus,
      dbFileSizeBytes: getDbFileSizeBytes(),
      queryStats: getQueryStats(),
      slowestQueries: getSlowestQueries(20),
      recentEngineEvents: getRecentEngineEvents(20),
      bufferInfo: getBufferInfo(),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
