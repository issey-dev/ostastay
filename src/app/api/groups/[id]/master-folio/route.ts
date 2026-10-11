import { NextResponse } from "next/server";
import { ensurePostingMaster } from "@/lib/groups/posting-master";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Creates the block's Posting Master reservation, whose folio is the master folio that group
// pickups route their charges to by default. Idempotent — returns the existing open
// master folio if one is already present.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "GROUP_BLOCKS", "update");

    const { id } = await params;
    const group = await prisma.groupBlock.findUnique({ where: { id }, include: { masterFolios: true } });
    if (!group) return NextResponse.json({ error: "Group block not found" }, { status: 404 });
    await assertPropertyAccess(ctx, group.propertyId);
    if (group.status === "CANCELLED" || group.status === "LOST") {
      return NextResponse.json({ error: "Cannot create a master folio for a closed block." }, { status: 400 });
    }

    // The master folio now belongs to the block's Posting Master reservation (created here
    // if the block has none yet; an older bare master folio is attached to it).
    let pm: Awaited<ReturnType<typeof ensurePostingMaster>>;
    try {
      pm = await ensurePostingMaster(group.id);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't create the master folio." }, { status: 400 });
    }
    const folio = pm.folio;
    if (!folio) return NextResponse.json({ error: "Couldn't create the master folio." }, { status: 500 });
    if (!pm.created) return NextResponse.json(folio);

    await logActivity({
      ctx,
      module: "GROUP_BLOCKS",
      action: "CREATE",
      entityType: "Reservation",
      entityId: pm.reservation.id,
      description: `Created Posting Master ${pm.reservation.confirmationNo} and master folio for group block ${group.code}`,
    });

    return NextResponse.json(folio, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
