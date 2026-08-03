import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { toUtcMidnight } from "@/lib/business-date";
import { logActivity } from "@/lib/activity-log";

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

    await logActivity({
      ctx,
      module: "CASHIERING",
      action: "DELETE",
      entityType: "Folio",
      entityId: id,
      description: `Deleted empty folio #${folio.folioNumber}`,
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
    const { payeeProfileId, isClosed, settlementMethod, defaultPaymentMethodId } = body;

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

    // Which method the Post Payment form pre-selects for this folio. Purely a
    // convenience — it settles nothing on its own; settlement follows the payment that
    // is actually taken (see /api/folios/[id]/payments). null clears the preference.
    if (defaultPaymentMethodId) {
      const method = await prisma.paymentMethod.findUnique({ where: { id: defaultPaymentMethodId } });
      if (!method || method.enterpriseId !== ctx.enterpriseId) {
        return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
      }
    }

    // Close/reopen bookkeeping: stamp the property business date on close; only allow a
    // REOPEN while the business date still equals that stamp (a Fast Post walk-in bill is
    // final once Night Audit rolls the day). Cleared on reopen.
    let closedBusinessDate: Date | null | undefined = undefined;
    if (isClosed !== undefined && isClosed !== existing.isClosed) {
      const property = await prisma.property.findUnique({ where: { id: existing.propertyId }, select: { businessDate: true } });
      const bizDate = toUtcMidnight(property?.businessDate ?? new Date());
      if (isClosed) {
        closedBusinessDate = bizDate;
      } else {
        if (existing.closedBusinessDate && toUtcMidnight(existing.closedBusinessDate).getTime() !== bizDate.getTime()) {
          return NextResponse.json(
            { error: "This bill was closed on a previous business date and can no longer be reopened." },
            { status: 400 }
          );
        }
        closedBusinessDate = null;
      }
    }

    // Closing a City-Ledger MASTER (group) folio with a payee finalizes it into a debtor
    // invoice for that account — it then shows in Debtors and production reports. Mirrors
    // how a reservation checkout finalizes a City-Ledger guest folio.
    const effectiveSettlement = settlementMethod ?? existing.settlementMethod;
    const effectivePayee = payeeProfileId !== undefined ? payeeProfileId : existing.payeeProfileId;
    const finalizeDebtor =
      isClosed === true && !existing.isClosed && existing.isMaster &&
      effectiveSettlement === "CITY_LEDGER" && !!effectivePayee;

    const updatedFolio = await prisma.folio.update({
      where: { id },
      data: {
        ...(payeeProfileId !== undefined && { payeeProfileId }),
        ...(isClosed !== undefined && { isClosed }),
        ...(closedBusinessDate !== undefined && { closedBusinessDate }),
        ...(settlementMethod !== undefined && { settlementMethod }),
        ...(defaultPaymentMethodId !== undefined && { defaultPaymentMethodId: defaultPaymentMethodId || null }),
        ...(finalizeDebtor && { isDebtorAccount: true }),
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

    const changes: string[] = [];
    if (payeeProfileId !== undefined && payeeProfileId !== existing.payeeProfileId) changes.push("payee");
    if (isClosed !== undefined && isClosed !== existing.isClosed) changes.push(isClosed ? "closed" : "reopened");
    if (settlementMethod !== undefined && settlementMethod !== existing.settlementMethod) changes.push(`settlement → ${settlementMethod}`);
    if (changes.length > 0) {
      await logActivity({
        ctx,
        module: "CASHIERING",
        action: "UPDATE",
        entityType: "Folio",
        entityId: id,
        description: `Updated folio #${existing.folioNumber}: ${changes.join(", ")}`,
      });
    }

    return NextResponse.json(updatedFolio);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
