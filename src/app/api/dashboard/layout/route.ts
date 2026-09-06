import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, toErrorResponse } from "@/lib/scope";
import { isStorableLayout, MAX_LAYOUT_BYTES } from "@/lib/dashboard/layout";

// The signed-in user's own Operations Dashboard arrangement.
//
// No requirePermission() and no propertyId, deliberately. This is a preference about how
// one person arranges their own screen, not tenant data: the row is keyed by the session's
// own userId, so there is nothing here to authorize beyond being signed in, and nothing a
// caller can name to reach somebody else's. What a user may SEE is decided elsewhere and
// is unaffected by anything written here — see /api/dashboard/overview.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireSession();
    const row = await prisma.userDashboardLayout.findUnique({
      where: { userId: ctx.userId },
      select: { layout: true, updatedAt: true },
    });
    // No row is the normal state for anyone who has never rearranged anything; the client
    // falls back to the shipped default rather than treating it as an error.
    return NextResponse.json({ layout: row?.layout ?? null, updatedAt: row?.updatedAt ?? null });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireSession();
    const body = await request.json().catch(() => null);
    const layout = body?.layout;

    // Shape-checked, not schema-validated: the column is opaque JSON whose meaning is
    // owned by the client (src/lib/dashboard/layout.ts reconciles whatever it reads
    // against the catalogue that actually shipped). The check that matters here is that
    // this is a layout at all and not an unbounded blob — a preference row must never
    // become somewhere to park arbitrary data.
    if (!isStorableLayout(layout)) {
      return NextResponse.json({ error: "Not a dashboard layout" }, { status: 400 });
    }
    if (JSON.stringify(layout).length > MAX_LAYOUT_BYTES) {
      return NextResponse.json({ error: "Layout is too large" }, { status: 413 });
    }

    await prisma.userDashboardLayout.upsert({
      where: { userId: ctx.userId },
      create: { userId: ctx.userId, layout },
      update: { layout },
    });

    // Deliberately not written to the activity log. That trail is for actions an auditor
    // needs to reconstruct; a user moving their own card would drown it.
    return NextResponse.json({ ok: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

/** Reset: drop the row and fall back to the shipped default. */
export async function DELETE() {
  try {
    const ctx = await requireSession();
    await prisma.userDashboardLayout.deleteMany({ where: { userId: ctx.userId } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
