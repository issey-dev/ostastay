import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { toUtcMidnight } from "@/lib/business-date";

// Fast Post History, room side: the charges keyed in through Fast Post onto in-house room
// folios, for one BUSINESS date (?date=yyyy-mm-dd; without it the latest 200). Walk-in bills
// are listed by /api/folios/walk-in. Only the revenue line is returned — the tax and
// service lines it generated are summed into its total.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "POS", "view");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    await assertPropertyAccess(ctx, propertyId);

    const date = searchParams.get("date");
    const start = date ? toUtcMidnight(new Date(`${date}T00:00:00.000Z`)) : null;

    const items = await prisma.folioLineItem.findMany({
      where: {
        postedVia: "FAST_POST",
        generatedFromLineItemId: null,
        folio: { propertyId, reservationId: { not: null } },
        ...(start ? { date: { gte: start, lt: new Date(start.getTime() + 86_400_000) } } : {}),
      },
      include: {
        generatedLines: { select: { amount: true, taxAmount: true, serviceChargeAmount: true, isVoid: true } },
        outlet: { select: { name: true } },
        outletCheck: { select: { checkNumber: true } },
        folio: {
          select: {
            id: true,
            folioNumber: true,
            isClosed: true,
            reservation: {
              select: {
                id: true,
                primaryGuest: { select: { firstName: true, lastName: true, companyName: true } },
                assignments: { select: { room: { select: { roomNumber: true } } }, orderBy: { startDate: "asc" } },
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 200,
    });

    const rows = items.map((li) => {
      const res = li.folio.reservation;
      const g = res?.primaryGuest;
      const total =
        li.amount + li.taxAmount + (li.serviceChargeAmount || 0) +
        li.generatedLines.filter((l) => !l.isVoid).reduce((s, l) => s + l.amount + l.taxAmount + (l.serviceChargeAmount || 0), 0);
      return {
        id: li.id,
        folioId: li.folio.id,
        folioNumber: li.folio.folioNumber,
        reservationId: res?.id ?? null,
        room: [...new Set((res?.assignments ?? []).map((a) => a.room?.roomNumber).filter(Boolean))].join(", ") || "TBA",
        guest: g ? g.companyName || `${g.firstName} ${g.lastName ?? ""}`.trim() : "",
        description: li.description,
        outletName: li.outlet?.name ?? null,
        checkNumber: li.outletCheck?.checkNumber ?? null,
        date: li.date,
        total: Math.round(total * 100) / 100,
        isVoid: li.isVoid,
        folioClosed: li.folio.isClosed,
      };
    });
    return NextResponse.json(rows);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
