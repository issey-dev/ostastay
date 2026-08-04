import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, hasPermission, toErrorResponse, ForbiddenError } from "@/lib/scope";

// "Who can I assign this work to?" — an OPERATIONAL lookup, deliberately separate from
// /api/settings/users, which is staff ADMINISTRATION.
//
// The two need different gates. Administration moved to the Hub in 2026-08-04 and is
// gated on the USERS module, which no property-scoped user can hold. But the housekeeping
// board still has to list room attendants, and the maintenance board its technicians —
// and the people who work those boards are exactly the ones without USERS.
//
// Before this route existed, both boards fetched /api/settings/users, which required
// CONTROLS view. The stock Housekeeping role has no CONTROLS at all, so a housekeeper
// opening their own board got a 403 and an empty attendant list. That was a live bug
// independent of the Hub move; this fixes it rather than carrying it across.
//
// The payload is deliberately minimal: enough to render and assign, and nothing about
// access, email, or scope.
const STAFF_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  jobFunction: true,
  isActive: true,
} as const;

export async function GET() {
  try {
    const ctx = await requireSession();

    // Anyone who can act on either board — plus a Hub administrator, so the same lookup
    // serves the People screen's pickers.
    const allowed =
      hasPermission(ctx, "HOUSEKEEPING", "view") ||
      hasPermission(ctx, "MAINTENANCE", "view") ||
      hasPermission(ctx, "USERS", "view");
    if (!allowed) {
      throw new ForbiddenError("Not authorized to view the staff list");
    }

    // A property-scoped user sees the people at their own work location, plus the
    // enterprise-wide staff who can be assigned anywhere. Without the second half, a
    // property board would hide the enterprise supervisor who actually does the rounds.
    const users = await prisma.user.findMany({
      where: {
        enterpriseId: ctx.enterpriseId,
        isActive: true,
        ...(ctx.scope === "PROPERTY"
          ? { OR: [{ scope: "ENTERPRISE" }, { propertyId: ctx.propertyId }] }
          : {}),
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: STAFF_SELECT,
    });

    return NextResponse.json(users);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
