import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

const FOLIO_DETAIL_INCLUDE = {
  reservation: {
    include: {
      primaryGuest: true,
      accompanyingGuests: { include: { profile: true } },
    },
  },
  payeeProfile: true,
  lineItems: {
    include: { chargeCode: true },
    orderBy: { date: "asc" as const },
  },
  payments: {
    include: { paymentMethod: true, shift: true },
    orderBy: { createdAt: "asc" as const },
  },
};

// Fetches a single folio by id — the fetch path for both a reservation's own Front
// Desk folio panel and the walk-in folio panel (walk-in folios have no reservationId
// to key a lookup off of, so they need this rather than GET /api/folios?reservationId=).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();

    const { id } = await params;
    const folio = await prisma.folio.findUnique({
      where: { id },
      include: FOLIO_DETAIL_INCLUDE,
    });
    if (!folio) {
      return NextResponse.json({ error: "Folio not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, folio.propertyId);

    return NextResponse.json(folio);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "delete");

    const { id } = await params;

    // Fetch the folio to verify it exists and check if it has line items or payments
    const folio = await prisma.folio.findUnique({
      where: { id },
      include: {
        lineItems: true,
        payments: true,
      }
    });

    if (!folio) {
      return NextResponse.json({ error: "Folio not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, folio.propertyId);

    if (folio.folioNumber === 1) {
      return NextResponse.json({ error: "Cannot delete the primary folio (Folio 1)" }, { status: 400 });
    }

    if (folio.lineItems.length > 0 || folio.payments.length > 0) {
      return NextResponse.json({ error: "Cannot delete a folio that has charges or payments" }, { status: 400 });
    }

    await prisma.folio.delete({
      where: { id }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "update");

    const { id } = await params;
    const body = await request.json();
    const { payeeProfileId, isClosed, settlementMethod } = body;

    const existing = await prisma.folio.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Folio not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.propertyId);

    if (payeeProfileId) {
      const payee = await prisma.profile.findUnique({ where: { upid: payeeProfileId } });
      if (!payee || payee.enterpriseId !== ctx.enterpriseId) {
        return NextResponse.json({ error: "Payee profile not found" }, { status: 404 });
      }
    }

    if (settlementMethod !== undefined && settlementMethod !== "DIRECT" && settlementMethod !== "CITY_LEDGER") {
      return NextResponse.json({ error: "Invalid settlement method" }, { status: 400 });
    }

    const updatedFolio = await prisma.folio.update({
      where: { id },
      data: {
        ...(payeeProfileId !== undefined && { payeeProfileId }),
        ...(isClosed !== undefined && { isClosed }),
        ...(settlementMethod !== undefined && { settlementMethod }),
      },
      include: {
        payeeProfile: true,
        lineItems: {
          include: { chargeCode: true },
          orderBy: { date: 'asc' }
        },
        payments: {
          include: { paymentMethod: true, shift: true },
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    return NextResponse.json(updatedFolio);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
