import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { toUtcMidnight } from "@/lib/business-date";
import { logActivity } from "@/lib/activity-log";

// History list of CLOSED walk-in (Fast Post) bills for a property, most recent first.
// Optional ?date=yyyy-mm-dd filters by the business date the bill was closed on. Each row
// carries computed totals and a `reopenable` flag (true only while the property's business
// date still equals the bill's close date — see PATCH /api/folios/[id]).
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "POS", "view");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    await assertPropertyAccess(ctx, propertyId);

    const where: { propertyId: string; reservationId: null; isClosed: true; closedBusinessDate?: { gte: Date; lt: Date } } = {
      propertyId,
      reservationId: null,
      isClosed: true,
    };
    const date = searchParams.get("date");
    if (date) {
      const start = toUtcMidnight(new Date(`${date}T00:00:00.000Z`));
      where.closedBusinessDate = { gte: start, lt: new Date(start.getTime() + 86_400_000) };
    }

    const [folios, property] = await Promise.all([
      prisma.folio.findMany({
        where,
        include: { lineItems: true, payments: true },
        orderBy: [{ closedBusinessDate: "desc" }, { id: "desc" }],
        take: 500,
      }),
      prisma.property.findUnique({ where: { id: propertyId }, select: { businessDate: true } }),
    ]);
    const bizMs = property?.businessDate ? toUtcMidnight(property.businessDate).getTime() : NaN;

    const rows = folios.map((f) => {
      const charges = f.lineItems.filter((li) => !li.isVoid).reduce((s, li) => s + li.amount + li.taxAmount + (li.serviceChargeAmount || 0), 0);
      const payments = f.payments.reduce((s, p) => s + (p.isRefund ? -p.amount : p.amount), 0);
      return {
        id: f.id,
        walkInGuestName: f.walkInGuestName,
        walkInGuestContact: f.walkInGuestContact,
        taxInvoiceNumber: f.taxInvoiceNumber,
        closedBusinessDate: f.closedBusinessDate,
        charges: Math.round(charges * 100) / 100,
        payments: Math.round(payments * 100) / 100,
        balance: Math.round((charges - payments) * 100) / 100,
        reopenable: f.closedBusinessDate ? toUtcMidnight(f.closedBusinessDate).getTime() === bizMs : false,
      };
    });
    return NextResponse.json(rows);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

// Opens a standalone bill for a guest who has no reservation — a passerby using an
// outlet without staying. Once created, this folio is posted to and paid off exactly
// like a reservation-backed one (POST /api/pos/charge, POST /api/folios/[id]/payments)
// since both now key off Folio.propertyId rather than Folio.reservation.propertyId.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "POS", "create");

    const body = await request.json();
    const { propertyId, walkInGuestName, walkInGuestContact } = body;

    if (!propertyId || !walkInGuestName) {
      return NextResponse.json({ error: "propertyId and walkInGuestName are required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);

    const folio = await prisma.folio.create({
      data: {
        propertyId,
        folioNumber: 1,
        walkInGuestName,
        walkInGuestContact: walkInGuestContact || null,
      },
    });

    await logActivity({
      ctx,
      module: "POS",
      action: "CREATE",
      entityType: "Folio",
      entityId: folio.id,
      description: `Opened walk-in folio for ${walkInGuestName}`,
    });

    return NextResponse.json(folio, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
