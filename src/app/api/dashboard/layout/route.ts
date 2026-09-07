import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { isStorableLayout, MAX_LAYOUT_BYTES } from "@/lib/dashboard/layout";

// The signed-in user's own Operations Dashboard arrangement, for one property.
//
// No requirePermission(): this is a preference about how one person arranges their own
// screen, not tenant data, and the row is keyed by the session's own userId — there is
// nothing here a caller can name to reach somebody else's. What a user may SEE is decided
// elsewhere and is unaffected by anything written here (see /api/dashboard/overview).
//
// assertPropertyAccess IS required though, and that is the difference from the first cut
// of this endpoint. It now takes a propertyId from the client, which is a tenant-scoped
// identifier: without the check a caller could name another enterprise's property and
// write rows against it. The helper also answers "not found" rather than "forbidden", so
// a property id cannot be probed for existence.
export const dynamic = "force-dynamic";

async function resolveProperty(request: Request, explicit?: unknown) {
  const ctx = await requireSession();
  const propertyId =
    typeof explicit === "string" && explicit
      ? explicit
      : (new URL(request.url).searchParams.get("propertyId") ?? "");
  if (!propertyId) return { ctx, propertyId: null as string | null };
  await assertPropertyAccess(ctx, propertyId);
  return { ctx, propertyId };
}

export async function GET(request: Request) {
  try {
    const { ctx, propertyId } = await resolveProperty(request);
    if (!propertyId) {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }

    const row = await prisma.userDashboardLayout.findUnique({
      where: { userId_propertyId: { userId: ctx.userId, propertyId } },
      select: { layout: true, updatedAt: true },
    });
    // No row is the normal state for a property this person has never arranged; the client
    // falls back to the shipped default rather than treating it as an error, and
    // deliberately does NOT borrow another property's layout.
    return NextResponse.json({ layout: row?.layout ?? null, updatedAt: row?.updatedAt ?? null });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const { ctx, propertyId } = await resolveProperty(request, body?.propertyId);
    if (!propertyId) {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }
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
      where: { userId_propertyId: { userId: ctx.userId, propertyId } },
      create: { userId: ctx.userId, propertyId, layout },
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

/** Reset one property back to the shipped default. Other properties are untouched. */
export async function DELETE(request: Request) {
  try {
    const { ctx, propertyId } = await resolveProperty(request);
    if (!propertyId) {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }
    await prisma.userDashboardLayout.deleteMany({ where: { userId: ctx.userId, propertyId } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
