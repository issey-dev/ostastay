import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { getOstaEnterpriseId } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// One license invoice: GET returns it together with everything the print page needs
// (Osta's own brand + stationery content from its EnterpriseSettings row), PATCH moves
// it through its tiny lifecycle: markPaid (stamps paidAt + receiptNo) or void.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) throw new ForbiddenError("Only Osta staff can view license invoices");
    requirePermission(ctx, "CONTROLS", "view");

    const { id } = await params;
    const invoice = await prisma.licenseInvoice.findUnique({
      where: { id },
      include: { enterprise: { select: { name: true, slug: true } } },
    });
    if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    const ostaId = await getOstaEnterpriseId();
    const [settings, properties, addonRows] = await Promise.all([
      prisma.enterpriseSettings.findUnique({ where: { enterpriseId: ostaId } }),
      prisma.property.findMany({
        where: { enterpriseId: invoice.enterpriseId },
        select: { name: true, code: true },
        orderBy: { name: "asc" },
      }),
      // Which sellable add-ons the enterprise has enabled anywhere — mentioned on the
      // invoice's single description line ("… — Spa add-on enabled").
      prisma.propertyModuleAccess.findMany({
        where: { enabled: true, property: { enterpriseId: invoice.enterpriseId } },
        select: { module: true },
        distinct: ["module"],
      }),
    ]);

    return NextResponse.json({
      invoice,
      ostaSettings: settings,
      properties,
      addons: addonRows.map((r) => r.module),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

async function nextReceiptNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.licenseInvoice.count({
    where: { receiptNo: { startsWith: `RCP-${year}-` } },
  });
  return `RCP-${year}-${String(count + 1).padStart(4, "0")}`;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) throw new ForbiddenError("Only Osta staff can update license invoices");
    requirePermission(ctx, "CONTROLS", "update");

    const { id } = await params;
    const body = await request.json();
    const invoice = await prisma.licenseInvoice.findUnique({
      where: { id },
      include: { enterprise: { select: { name: true } } },
    });
    if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    if (body.action === "markPaid") {
      if (invoice.status !== "ISSUED") {
        return NextResponse.json({ error: `Only an ISSUED invoice can be marked paid (this one is ${invoice.status})` }, { status: 400 });
      }
      const updated = await prisma.licenseInvoice.update({
        where: { id },
        data: {
          status: "PAID",
          paidAt: new Date(),
          paymentReference: body.paymentReference || null,
          receiptNo: await nextReceiptNumber(),
        },
      });
      await logActivity({
        ctx,
        module: "CONTROLS",
        action: "UPDATE",
        entityType: "LicenseInvoice",
        entityId: id,
        description: `Marked license invoice ${invoice.invoiceNo} ("${invoice.enterprise.name}") paid — receipt ${updated.receiptNo}${body.paymentReference ? `, ref ${body.paymentReference}` : ""}`,
      });
      return NextResponse.json(updated);
    }

    if (body.action === "void") {
      if (invoice.status === "PAID") {
        return NextResponse.json({ error: "A paid invoice cannot be voided" }, { status: 400 });
      }
      const updated = await prisma.licenseInvoice.update({ where: { id }, data: { status: "VOID" } });
      await logActivity({
        ctx,
        module: "CONTROLS",
        action: "UPDATE",
        entityType: "LicenseInvoice",
        entityId: id,
        description: `Voided license invoice ${invoice.invoiceNo} ("${invoice.enterprise.name}")`,
      });
      return NextResponse.json(updated);
    }

    return NextResponse.json({ error: "action must be markPaid or void" }, { status: 400 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
