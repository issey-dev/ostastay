import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse, requireCapability } from "@/lib/scope";
import { resolveBusinessDate, toUtcMidnight } from "@/lib/business-date";
import { logActivity } from "@/lib/activity-log";

// Reverse an Advance Folio made by mistake (Agent Portal plan A-23, Phase 8). Same business
// date only: the lines it posted (one check number, on the folio it posted to, dated today)
// are voided — never deleted — and advanceBilledThrough goes back to what it was, so Night
// Audit posts those nights again. Transfer charges it posted keep their own numbers and are
// voided from the folio as usual if needed.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "update");
    requireCapability(ctx, "billing.advanceFolio");
    const { id } = await params;
    const r = await prisma.reservation.findUnique({
      where: { id },
      include: { property: { select: { businessDate: true } } },
    });
    if (!r) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    await assertPropertyAccess(ctx, r.propertyId);
    if (!r.advanceFolioCheckNo || !r.advanceFolioDate || !r.advanceFolioFolioId) {
      return NextResponse.json({ error: "There is no Advance Folio to reverse on this booking." }, { status: 400 });
    }
    const today = toUtcMidnight(resolveBusinessDate(r.property));
    if (toUtcMidnight(r.advanceFolioDate).getTime() !== today.getTime()) {
      return NextResponse.json({ error: "An Advance Folio can be reversed only on the business date it was posted." }, { status: 400 });
    }
    const voided = await prisma.$transaction(async (tx) => {
      const claim = await tx.reservation.updateMany({
        where: { id, advanceFolioCheckNo: r.advanceFolioCheckNo },
        data: {
          advanceBilledThrough: r.advanceFolioPrevThrough,
          advanceFolioCheckNo: null,
          advanceFolioDate: null,
          advanceFolioPrevThrough: null,
          advanceFolioFolioId: null,
        },
      });
      if (claim.count === 0) return -1;
      const v = await tx.folioLineItem.updateMany({
        where: { folioId: r.advanceFolioFolioId!, checkNo: r.advanceFolioCheckNo, isVoid: false, date: { gte: today, lt: new Date(today.getTime() + 86_400_000) } },
        data: { isVoid: true },
      });
      return v.count;
    });
    if (voided < 0) return NextResponse.json({ error: "This Advance Folio was just changed. Reload." }, { status: 409 });
    await logActivity({
      ctx,
      module: "CASHIERING",
      action: "VOID",
      entityType: "Reservation",
      entityId: id,
      description: `Advance Folio reversed on ${r.confirmationNo}: ${voided} line(s) voided`,
    });
    return NextResponse.json({ success: true, voided });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
