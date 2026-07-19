import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { buildInvoiceSummary } from "@/lib/debtor-accounts";
import { computeFolioAgingBuckets } from "@/lib/debtor-aging";

const INVOICE_INCLUDE = {
  lineItems: true,
  payments: true,
  reservation: { include: { primaryGuest: true } },
} as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "DEBTORS", "view");

    const { profileId } = await params;
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);

    const profile = await prisma.profile.findUnique({ where: { upid: profileId } });
    if (!profile || profile.enterpriseId !== ctx.enterpriseId || !profile.isCreditAccount) {
      return NextResponse.json({ error: "Credit account not found" }, { status: 404 });
    }

    const folios = await prisma.folio.findMany({
      where: { propertyId, payeeProfileId: profileId, isDebtorAccount: true },
      include: INVOICE_INCLUDE,
      orderBy: { reservation: { checkOutDate: "desc" } },
    });

    const invoices = folios.map(buildInvoiceSummary);
    const openInvoices = invoices.filter((inv) => inv.isOpen);
    const balance = openInvoices.reduce((sum, inv) => sum + inv.balance, 0);
    const aging = computeFolioAgingBuckets(
      openInvoices.map((inv) => ({ balance: inv.balance, referenceDate: inv.checkOutDate ?? new Date() }))
    );

    return NextResponse.json({ profile, invoices, balance, aging });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
