import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";

// The one legitimate cross-tenant property query in the codebase — every other
// property route scopes to ctx.enterpriseId. Osta-only: lists properties across ALL
// enterprises so staff can review/approve new submissions.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can review properties across enterprises");
    }
    requirePermission(ctx, "CONTROLS", "view");

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status"); // PENDING (default) | ACTIVE | REJECTED | ALL

    const properties = await prisma.property.findMany({
      where: status && status !== "ALL" ? { status } : status === "ALL" ? {} : { status: "PENDING" },
      include: {
        enterprise: { select: { id: true, name: true, slug: true } },
        reviewedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json(properties);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
