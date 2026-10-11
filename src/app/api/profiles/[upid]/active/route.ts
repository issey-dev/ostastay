import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// POST { isActive: boolean } - deactivate (hide from pickers and searches, keep every record)
// or reactivate a profile. A guest with a booking still to come or in the house stays active.
export async function POST(request: Request, { params }: { params: Promise<{ upid: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "PROFILES", "update");
    const { upid } = await params;
    const body = await request.json().catch(() => ({}));
    if (typeof body.isActive !== "boolean") return NextResponse.json({ error: "isActive is required" }, { status: 400 });

    const profile = await prisma.profile.findUnique({ where: { upid } });
    if (!profile || profile.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    if (!body.isActive) {
      const live = await prisma.reservation.count({
        where: {
          status: { in: ["RESERVED", "IN_HOUSE"] },
          OR: [{ primaryGuestId: upid }, { travelAgentId: upid }, { accompanyingGuests: { some: { profileId: upid } } }],
        },
      });
      if (live > 0) {
        return NextResponse.json(
          { error: `This profile has ${live} upcoming or in-house reservation${live > 1 ? "s" : ""}. Deactivate it once they are done.` },
          { status: 400 }
        );
      }
    }

    const updated = await prisma.profile.update({
      where: { upid },
      data: { isActive: body.isActive, deactivatedAt: body.isActive ? null : new Date() },
      select: { upid: true, isActive: true },
    });
    await logActivity({
      ctx,
      module: "PROFILES",
      action: "UPDATE",
      entityType: "Profile",
      entityId: upid,
      description: `${body.isActive ? "Reactivated" : "Deactivated"} profile ${profile.companyName || `${profile.firstName} ${profile.lastName ?? ""}`.trim()}`,
    });
    return NextResponse.json(updated);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
