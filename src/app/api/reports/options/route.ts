import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, resolveCurrentPropertyId, toErrorResponse } from "@/lib/scope";
import type { ReportOptionSource } from "@/lib/reports/types";

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
        options = ["ROOM", "FOOD_BEVERAGE", "TRANSPORTATION", "OTHERS", "TAX", "SYSTEM"].map((c) => ({ label: c.replace("_", " "), value: c }));
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
