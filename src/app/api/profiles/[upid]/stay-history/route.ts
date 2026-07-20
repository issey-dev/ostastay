import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertProfileAccess, toErrorResponse } from "@/lib/scope";

// Future/History stay records for a profile — see .agents/docs/PROFILES_REDESIGN_PLAN.md
// "Stay History". Profile is enterprise-wide (no propertyId of its own), so this spans
// every property in the enterprise; an optional ?propertyId= narrows the "visits to
// THIS property" count specifically (Reservation is property-scoped, unlike Profile).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ upid: string }> }
) {
  try {
    const ctx = await requireSession();
    const { upid } = await params;
    await assertProfileAccess(ctx, upid);

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");

    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const reservations = await prisma.reservation.findMany({
      where: { primaryGuestId: upid },
      include: {
        property: { select: { id: true, name: true } },
        assignments: { include: { roomType: { select: { name: true } } }, orderBy: { startDate: "asc" } },
        folios: {
          include: {
            lineItems: { include: { chargeCode: { select: { code: true, description: true } } } },
          },
        },
      },
      orderBy: { checkInDate: "desc" },
    });

    const withBreakdown = reservations.map((r) => {
      const byChargeCode = new Map<string, { code: string; description: string; amount: number }>();
      let total = 0;
      for (const folio of r.folios) {
        for (const item of folio.lineItems) {
          if (item.isVoid) continue;
          const gross = item.amount + item.taxAmount + (item.serviceChargeAmount || 0);
          total += gross;
          const key = item.chargeCode.code;
          const existing = byChargeCode.get(key);
          if (existing) {
            existing.amount += gross;
          } else {
            byChargeCode.set(key, { code: item.chargeCode.code, description: item.chargeCode.description, amount: gross });
          }
        }
      }
      return {
        id: r.id,
        confirmationNo: r.confirmationNo,
        status: r.status,
        propertyId: r.property.id,
        propertyName: r.property.name,
        checkInDate: r.checkInDate,
        checkOutDate: r.checkOutDate,
        roomTypes: [...new Set(r.assignments.map((a) => a.roomType.name))],
        revenueTotal: Math.round(total * 100) / 100,
        revenueBreakdown: [...byChargeCode.values()].map((v) => ({ ...v, amount: Math.round(v.amount * 100) / 100 })),
      };
    });

    const future = withBreakdown
      .filter((r) => ["RESERVED", "IN_HOUSE"].includes(r.status) && new Date(r.checkOutDate) >= todayStart)
      .sort((a, b) => new Date(a.checkInDate).getTime() - new Date(b.checkInDate).getTime());
    const history = withBreakdown
      .filter((r) => r.status === "CHECKED_OUT")
      .sort((a, b) => new Date(b.checkOutDate).getTime() - new Date(a.checkOutDate).getTime());

    const visitsToProperty = propertyId
      ? history.filter((r) => r.propertyId === propertyId).length
      : null;

    return NextResponse.json({ future, history, visitsToProperty });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
