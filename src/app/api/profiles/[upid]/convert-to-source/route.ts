import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { defaultSourceColor } from "@/lib/source-profile";
import { logActivity } from "@/lib/activity-log";

// Convert a Travel Agent profile to a Source (Agent Portal plan §7). Everything it holds
// stays: commission, credit account, negotiated rates. Its existing bookings keep it as their
// Travel Agent; new bookings can carry it as their Source.
export async function POST(_request: Request, { params }: { params: Promise<{ upid: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "PROFILES", "update");
    const { upid } = await params;
    const p = await prisma.profile.findUnique({ where: { upid } });
    if (!p || p.enterpriseId !== ctx.enterpriseId) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    if (p.profileType !== "TRAVEL_AGENT") {
      return NextResponse.json({ error: "Only a travel agent profile can be converted to a source." }, { status: 400 });
    }
    const updated = await prisma.profile.update({
      where: { upid },
      data: {
        profileType: "SOURCE",
        markerColor: p.markerColor ?? (await defaultSourceColor(ctx.enterpriseId)),
        markerIcon: p.markerIcon ?? "Briefcase",
      },
    });
    await logActivity({
      ctx,
      module: "PROFILES",
      action: "UPDATE",
      entityType: "Profile",
      entityId: upid,
      description: `Converted travel agent "${p.companyName ?? p.firstName}" to a source`,
    });
    return NextResponse.json(updated);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
