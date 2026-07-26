import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Creates the block's master folio (the "PM" / Posting Master account) that group
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

    const existing = group.masterFolios.find((f) => f.isMaster && !f.isClosed);
    if (existing) return NextResponse.json(existing);

    const folio = await prisma.folio.create({
      data: {
        propertyId: group.propertyId,
        groupBlockId: group.id,
        isMaster: true,
        // Group-level folio, not tied to a single reservation; labelled for the panel.
        walkInGuestName: `${group.name} — Master Folio`,
        // Block linked to a credit account → the master bill is a City-Ledger receivable
        // for it; closing the folio finalizes the debtor invoice (see folios/[id] PATCH).
        ...(group.payeeProfileId
          ? { settlementMethod: "CITY_LEDGER", payeeProfileId: group.payeeProfileId }
          : {}),
      },
    });

    await logActivity({
      ctx,
      module: "GROUP_BLOCKS",
      action: "CREATE",
      entityType: "Folio",
      entityId: folio.id,
      description: `Created master folio for group block ${group.code}`,
    });

    return NextResponse.json(folio, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
