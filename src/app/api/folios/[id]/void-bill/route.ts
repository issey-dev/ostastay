import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Void an ENTIRE bill (Fast Post walk-in sale) — flags every non-void line item isVoid,
// cancelling the sale. Never deletes; a reason is required and recorded in the activity
// log. Blocked on a closed folio (reopen first). Any payments already taken are left in
// place, so the resulting negative balance surfaces a refund the desk handles separately.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "update");

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      return NextResponse.json({ error: "A reason is required to void the bill." }, { status: 400 });
    }

    const folio = await prisma.folio.findUnique({ where: { id }, include: { lineItems: true } });
    if (!folio) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, folio.propertyId);

    if (folio.isClosed) {
      return NextResponse.json({ error: "Cannot void a closed bill — reopen it first." }, { status: 400 });
    }

    const toVoid = folio.lineItems.filter((li) => !li.isVoid);
    if (toVoid.length === 0) {
      return NextResponse.json({ error: "There are no charges to void on this bill." }, { status: 400 });
    }

    await prisma.folioLineItem.updateMany({
      where: { id: { in: toVoid.map((li) => li.id) } },
      data: { isVoid: true },
    });

    await logActivity({
      ctx,
      module: "POS",
      action: "VOID",
      entityType: "Folio",
      entityId: id,
      description: `Voided bill${folio.walkInGuestName ? ` for ${folio.walkInGuestName}` : ""} — ${toVoid.length} charge${toVoid.length > 1 ? "s" : ""}. Reason: ${reason}`,
    });

    return NextResponse.json({ success: true, voided: toVoid.length });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
