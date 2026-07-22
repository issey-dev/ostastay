import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { EOD_REPORT_LABELS, type EodReportType } from "@/lib/eod-reports";

export const dynamic = "force-dynamic";

// Read the frozen EOD report snapshots.
//   ?propertyId=…               → the list of business dates that have snapshots.
//   ?propertyId=…&date=YYYY-MM-DD → the six reports for that date (parsed JSON).
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "NIGHT_AUDIT", "view");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    await assertPropertyAccess(ctx, propertyId);

    const dateStr = searchParams.get("date");

    if (!dateStr) {
      // Distinct business dates that have a snapshot, newest first.
      const rows = await prisma.eodReport.findMany({
        where: { propertyId },
        select: { businessDate: true, generatedAt: true },
        orderBy: { businessDate: "desc" },
      });
      const seen = new Set<string>();
      const dates: Array<{ businessDate: string; generatedAt: string }> = [];
      for (const r of rows) {
        const key = r.businessDate.toISOString();
        if (seen.has(key)) continue;
        seen.add(key);
        dates.push({ businessDate: key, generatedAt: r.generatedAt.toISOString() });
      }
      return NextResponse.json({ dates });
    }

    const businessDate = new Date(`${dateStr}T00:00:00.000Z`);
    if (Number.isNaN(businessDate.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const rows = await prisma.eodReport.findMany({ where: { propertyId, businessDate } });
    if (rows.length === 0) {
      return NextResponse.json({ error: "No reports snapshotted for that date." }, { status: 404 });
    }

    const reports: Record<string, unknown> = {};
    for (const r of rows) {
      reports[r.reportType] = JSON.parse(r.data);
    }

    return NextResponse.json({
      businessDate: businessDate.toISOString(),
      labels: EOD_REPORT_LABELS,
      order: Object.keys(EOD_REPORT_LABELS) as EodReportType[],
      reports,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
