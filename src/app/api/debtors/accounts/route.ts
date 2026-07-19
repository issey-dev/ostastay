import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { buildInvoiceSummary } from "@/lib/debtor-accounts";

const INVOICE_INCLUDE = {
  lineItems: true,
  payments: true,
  reservation: { include: { primaryGuest: true } },
} as const;

// Lists every activated credit-account Profile (COMPANY/TRAVEL_AGENT) in the
// enterprise, each row showing its open-invoice balance at THIS property — invoices
// only exist once a City-Ledger reservation has actually checked out (see
// reservations/[id]/check-out/route.ts), so an in-house stay never contributes here.
// A TA/company operating across multiple properties gets an independent balance per
// property, consistent with how every other entity in this app is property-scoped.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "DEBTORS", "view");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);

    const accounts = await prisma.profile.findMany({
      where: { enterpriseId: ctx.enterpriseId, isCreditAccount: true },
      include: {
        foliosAsPayee: {
          where: { propertyId, isDebtorAccount: true },
          include: INVOICE_INCLUDE,
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const result = accounts.map((profile) => {
      const invoices = profile.foliosAsPayee.map(buildInvoiceSummary);
      const balance = invoices.filter((inv) => inv.isOpen).reduce((sum, inv) => sum + inv.balance, 0);
      return {
        upid: profile.upid,
        profileType: profile.profileType,
        firstName: profile.firstName,
        lastName: profile.lastName,
        companyName: profile.companyName,
        arNumber: profile.arNumber,
        creditLimit: profile.creditLimit,
        invoiceCount: invoices.length,
        openInvoiceCount: invoices.filter((inv) => inv.isOpen).length,
        balance,
        overLimit: profile.creditLimit != null && balance > profile.creditLimit,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
