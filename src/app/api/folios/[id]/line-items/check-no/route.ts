import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Re-numbers folio lines' check number (FolioLineItem.checkNo — owner, 2026-09-26). The
// folio screen rolls lines sharing a number in the same folio up into one line; staff can
// change a line's number, and lines that no longer share one stop rolling up. Only the
// number changes — amounts, codes, dates and void state are untouched.
const checkNoSchema = z.object({
  lineItemIds: z.array(z.string().min(1)).min(1, "Choose at least one line").max(500, "Too many lines at once"),
  checkNo: z
    .string({ message: "Enter a check number" })
    .trim()
    .min(1, "Enter a check number")
    .max(20, "Check number is 20 characters at most")
    .regex(/^[A-Za-z0-9-]+$/, "Letters, digits and '-' only"),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "update");

    const { id: folioId } = await params;
    const parsed = checkNoSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request", issues: parsed.error.issues }, { status: 400 });
    }
    const { checkNo } = parsed.data;
    const lineItemIds = [...new Set(parsed.data.lineItemIds)];

    const folio = await prisma.folio.findUnique({
      where: { id: folioId },
      select: { id: true, propertyId: true, folioNumber: true, isClosed: true, isDebtorAccount: true },
    });
    if (!folio) {
      return NextResponse.json({ error: "Folio not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, folio.propertyId);

    // A closed folio (or a finalized debtor invoice) is an issued document — its lines are
    // immutable, the same rule the void and move routes apply.
    if (folio.isClosed || folio.isDebtorAccount) {
      return NextResponse.json(
        { error: `Cannot change check numbers on a ${folio.isDebtorAccount ? "finalized debtor" : "closed"} folio` },
        { status: 400 }
      );
    }

    const lines = await prisma.folioLineItem.findMany({
      where: { id: { in: lineItemIds } },
      select: { id: true, folioId: true, checkNo: true },
    });
    if (lines.length !== lineItemIds.length || lines.some((l) => l.folioId !== folioId)) {
      return NextResponse.json({ error: "One or more lines are not on this folio" }, { status: 400 });
    }

    const { count } = await prisma.folioLineItem.updateMany({
      where: { id: { in: lineItemIds }, folioId },
      data: { checkNo },
    });

    const previous = [...new Set(lines.map((l) => l.checkNo ?? "none"))].join(", ");
    await logActivity({
      ctx,
      module: "CASHIERING",
      action: "UPDATE",
      entityType: "Folio",
      entityId: folioId,
      description: `Set check number ${checkNo} on ${count} line${count === 1 ? "" : "s"} of folio #${folio.folioNumber} (was ${previous})`,
    });

    return NextResponse.json({ updated: count });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
