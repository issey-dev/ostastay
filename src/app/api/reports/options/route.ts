import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, resolveCurrentPropertyId, toErrorResponse } from "@/lib/scope";
import type { ReportOptionSource } from "@/lib/reports/types";
import { REPORT_BUCKETS } from "@/lib/posting/charge-tree";
import { reportBucketLabel } from "@/lib/posting/report-bucket";

export const dynamic = "force-dynamic";

// Dynamic option lists for report parameters (per current property).
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "REPORTS", "view");

    const source = new URL(request.url).searchParams.get("source") as ReportOptionSource | null;
    const propertyId = await resolveCurrentPropertyId(ctx);
    let options: { label: string; value: string }[] = [];

    switch (source) {
      case "outlets":
        options = propertyId
          ? (await prisma.outlet.findMany({ where: { propertyId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })).map((o) => ({ label: o.name, value: o.id }))
          : [];
        break;
      case "roomTypes":
        options = propertyId
          ? (await prisma.roomType.findMany({ where: { propertyId, isActive: true, isPseudo: false }, select: { id: true, name: true }, orderBy: { name: "asc" } })).map((t) => ({ label: t.name, value: t.id }))
          : [];
        break;
      case "travelAgents":
        options = (await prisma.profile.findMany({ where: { enterpriseId: ctx.enterpriseId, profileType: { in: ["TRAVEL_AGENT", "COMPANY"] } }, select: { upid: true, companyName: true, firstName: true }, orderBy: { companyName: "asc" }, take: 500 })).map((p) => ({ label: p.companyName ?? p.firstName, value: p.upid }));
        break;
      case "chargeCategories":
        // Driven by the enterprise's own ChargeGroups (deduped by reporting bucket) —
        // not a literal array that drifts from the schema and the write validation, as
        // the three contradictory lists in CHARGE_CODE_PLAN.md §1.4 did. Falls back to
        // the canonical set for an enterprise whose tree hasn't been seeded yet.
        {
          const groups = await prisma.chargeGroup.findMany({
            where: { enterpriseId: ctx.enterpriseId },
            select: { reportBucket: true },
            orderBy: { sortOrder: "asc" },
          });
          const buckets = groups.length > 0
            ? [...new Set(groups.map((g) => g.reportBucket))]
            : [...REPORT_BUCKETS];
          options = buckets.map((b) => ({ label: reportBucketLabel(b), value: b }));
        }
        break;
      case "reservationStatuses":
        options = ["RESERVED", "IN_HOUSE", "CHECKED_OUT", "NO_SHOW", "CANCELLED"].map((s) => ({ label: s.replace("_", " "), value: s }));
        break;
      case "traceTypes":
        options = ["GUEST_MESSAGE", "WAKE_UP_CALL", "MAINTENANCE", "FRONT_DESK"].map((s) => ({ label: s.replace(/_/g, " "), value: s }));
        break;
      case "cashiers":
        options = propertyId
          ? (await prisma.user.findMany({ where: { OR: [{ propertyId }, { enterpriseId: ctx.enterpriseId, scope: "ENTERPRISE" }] }, select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: "asc" }, take: 500 })).map((u) => ({ label: `${u.firstName} ${u.lastName ?? ""}`.trim(), value: u.id }))
          : [];
        break;
      default:
        options = [];
    }

    return NextResponse.json({ options });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
