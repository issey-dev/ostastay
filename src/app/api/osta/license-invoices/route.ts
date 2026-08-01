import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Licensing invoices Osta issues to client enterprises — Osta-only in both directions
// (a tenant-facing "my invoices" view can reuse GET later with an ownership check).
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) throw new ForbiddenError("Only Osta staff can view license invoices");
    requirePermission(ctx, "CONTROLS", "view");

    const { searchParams } = new URL(request.url);
    const enterpriseId = searchParams.get("enterpriseId");

    const invoices = await prisma.licenseInvoice.findMany({
      where: enterpriseId ? { enterpriseId } : undefined,
      include: { enterprise: { select: { name: true, slug: true } } },
      orderBy: { issuedAt: "desc" },
      take: 200,
    });
    return NextResponse.json(invoices);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

// Sequential, human-readable numbering per year: LIC-2026-0001. The count+1 scheme is
// fine at Osta's scale (one issuer, no concurrency to speak of); the unique constraint
// on invoiceNo is the real guard, and a rare collision surfaces as a clean 400 rather
// than a duplicate number.
async function nextNumber(prefix: "LIC" | "RCP"): Promise<string> {
  const year = new Date().getFullYear();
  const field = prefix === "LIC" ? "invoiceNo" : "receiptNo";
  const count = await prisma.licenseInvoice.count({
    where: { [field]: { startsWith: `${prefix}-${year}-` } },
  });
  return `${prefix}-${year}-${String(count + 1).padStart(4, "0")}`;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) throw new ForbiddenError("Only Osta staff can issue license invoices");
    requirePermission(ctx, "CONTROLS", "create");

    const body = await request.json();
    const { enterpriseId, periodStart, periodEnd, amount, discountAmount, currency, dueAt, notes } = body;

    if (!enterpriseId || !periodStart || !periodEnd || amount === undefined || amount === null) {
      return NextResponse.json({ error: "enterpriseId, periodStart, periodEnd and amount are required" }, { status: 400 });
    }
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount < 0) {
      return NextResponse.json({ error: "amount must be a non-negative number" }, { status: 400 });
    }
    // Goodwill discount shown on the printed invoice. `amount` stays the NET payable;
    // the document derives the list price as amount + discount.
    const parsedDiscount = discountAmount !== undefined && discountAmount !== null && discountAmount !== "" ? parseFloat(discountAmount) : 0;
    if (isNaN(parsedDiscount) || parsedDiscount < 0) {
      return NextResponse.json({ error: "discountAmount must be a non-negative number" }, { status: 400 });
    }
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
      return NextResponse.json({ error: "Invalid billing period" }, { status: 400 });
    }

    const enterprise = await prisma.enterprise.findUnique({ where: { id: enterpriseId }, select: { id: true, name: true, type: true } });
    if (!enterprise) return NextResponse.json({ error: "Enterprise not found" }, { status: 404 });
    if (enterprise.type === "INTERNAL") {
      return NextResponse.json({ error: "Osta cannot invoice itself" }, { status: 400 });
    }

    const invoice = await prisma.licenseInvoice.create({
      data: {
        enterpriseId,
        invoiceNo: await nextNumber("LIC"),
        periodStart: start,
        periodEnd: end,
        amount: parsedAmount,
        discountAmount: parsedDiscount,
        currency: currency ? String(currency).toUpperCase().slice(0, 8) : "USD",
        dueAt: dueAt ? new Date(dueAt) : null,
        notes: notes || null,
      },
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "CREATE",
      entityType: "LicenseInvoice",
      entityId: invoice.id,
      description: `Issued license invoice ${invoice.invoiceNo} to "${enterprise.name}" — ${invoice.currency} ${invoice.amount.toFixed(2)} for ${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`,
    });

    return NextResponse.json(invoice, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
