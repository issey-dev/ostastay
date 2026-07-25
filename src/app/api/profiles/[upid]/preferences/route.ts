import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertProfileAccess, toErrorResponse } from "@/lib/scope";

// Dietary Requirements and Preferences are genuine multi-selects (see
// .agents/docs/PROFILES_REDESIGN_PLAN.md) — a tag-selection UI, not row-by-row
// editable entities like Communications/Address/Identification, so a whole-category
// replace is the right shape here (no isPrimary/ordering concept to lose).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ upid: string }> }
) {
  try {
    const ctx = await requireSession();
    const { upid } = await params;
    await assertProfileAccess(ctx, upid);
    requirePermission(ctx, "PROFILES", "view");

    const preferences = await prisma.profilePreference.findMany({ where: { upid } });
    return NextResponse.json(preferences);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ upid: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "PROFILES", "update");
    const { upid } = await params;
    await assertProfileAccess(ctx, upid);

    const body = await request.json();
    if (!body.category || !Array.isArray(body.values)) {
      return NextResponse.json({ error: "category and values[] are required" }, { status: 400 });
    }

    await prisma.$transaction([
      prisma.profilePreference.deleteMany({ where: { upid, category: body.category } }),
      prisma.profilePreference.createMany({
        data: body.values.map((value: string) => ({ upid, category: body.category, value })),
      }),
    ]);

    const preferences = await prisma.profilePreference.findMany({ where: { upid, category: body.category } });
    return NextResponse.json(preferences);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
