import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

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
      // The attached travel agent / corporate profile — a valid folio payee
      // (bill-to-account) alongside the guest and sharers.
      travelAgent: true,
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
          propertyId: reservation.propertyId,
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
    const { reservationId, payeeProfileId } = body;

    if (!reservationId) {
      return NextResponse.json({ error: "Missing reservationId" }, { status: 400 });
    }

    const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, reservation.propertyId);

    // Optional bill-to owner (a sharer, or the travel agent / corporate) + settlement
    // method — used to open a dedicated bill-to folio, e.g. the TA's City-Ledger window
    // that certain charges route to. The payee must belong to this enterprise.
    if (payeeProfileId) {
      const payee = await prisma.profile.findUnique({ where: { upid: payeeProfileId } });
      if (!payee || payee.enterpriseId !== ctx.enterpriseId) {
        return NextResponse.json({ error: "Payee profile not found" }, { status: 404 });
      }
    }
    const settlementMethod = body.settlementMethod === "CITY_LEDGER" ? "CITY_LEDGER"
      : body.settlementMethod === "DIRECT" ? "DIRECT" : undefined;

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
        propertyId: reservation.propertyId,
        folioNumber: nextFolioNumber,
        ...(payeeProfileId ? { payeeProfileId } : {}),
        ...(settlementMethod ? { settlementMethod } : {}),
      },
      include: FOLIO_INCLUDE
    });

    await logActivity({
      ctx,
      module: "CASHIERING",
      action: "CREATE",
      entityType: "Folio",
      entityId: newFolio.id,
      description: `Opened folio #${nextFolioNumber} on reservation ${reservation.confirmationNo}`,
    });

    return NextResponse.json(newFolio);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
