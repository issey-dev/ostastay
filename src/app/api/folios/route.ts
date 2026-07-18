import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

const FOLIO_INCLUDE = {
  lineItems: {
    include: { chargeCode: true },
    orderBy: { date: 'asc' as const }
  },
  payments: {
    include: { paymentMethod: true, shift: true },
    orderBy: { createdAt: 'asc' as const }
  },
  payeeProfile: true,
  reservation: {
    include: {
      primaryGuest: true,
      accompanyingGuests: { include: { profile: true } }
    }
  }
};

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const reservationId = searchParams.get("reservationId");

    if (!reservationId) {
      return NextResponse.json({ error: "Missing reservationId" }, { status: 400 });
    }

    const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, reservation.propertyId);

    let folios = await prisma.folio.findMany({
      where: { reservationId },
      include: FOLIO_INCLUDE,
      orderBy: { folioNumber: 'asc' }
    });

    if (folios.length === 0) {
      // Auto-create default folio for legacy or seeded bookings
      const newFolio = await prisma.folio.create({
        data: {
          reservationId,
          folioNumber: 1
        },
        include: FOLIO_INCLUDE
      });
      folios = [newFolio];
    }

    return NextResponse.json(folios);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "create");

    const body = await request.json();
    const { reservationId } = body;

    if (!reservationId) {
      return NextResponse.json({ error: "Missing reservationId" }, { status: 400 });
    }

    const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, reservation.propertyId);

    // Determine the next folio number
    const existingFolios = await prisma.folio.findMany({
      where: { reservationId },
      orderBy: { folioNumber: 'desc' },
      take: 1
    });

    const nextFolioNumber = existingFolios.length > 0 ? existingFolios[0].folioNumber + 1 : 1;

    const newFolio = await prisma.folio.create({
      data: {
        reservationId,
        folioNumber: nextFolioNumber
      },
      include: FOLIO_INCLUDE
    });

    return NextResponse.json(newFolio);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
