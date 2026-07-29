import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ReservationStatus } from "@/lib/enums";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { findTypeAvailabilityConflicts } from "@/lib/availability";
import { getFeeRuleById, computeReservationFee } from "@/lib/fee-rules";
import { resolveBusinessDate, toUtcMidnight } from "@/lib/business-date";
import { postCharge, chargeCodeInclude } from "@/lib/posting/post-charge";
import { logActivity } from "@/lib/activity-log";
import { toCents, fromCents, subMoney } from "@/lib/money";

// The reservation lifecycle is a guarded state machine, not a free-text field.
// Check-in and check-out have their own dedicated routes (which validate room
// assignment, settle balances, and finalize debtor invoices) — this route only
// handles the transitions that don't move money on their own. Jumping straight to
// CHECKED_OUT here would bypass the entire settlement flow, so it's never allowed.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  RESERVED: ["CANCELLED", "NO_SHOW"],
  IN_HOUSE: [], // must go through /check-out
  NO_SHOW: ["RESERVED", "CANCELLED"], // late arrival / cleanup
  CANCELLED: ["RESERVED"], // reinstate
  CHECKED_OUT: [], // terminal
};

const TRANSITION_HINTS: Record<string, string> = {
  IN_HOUSE: "Use the Check-In action instead of setting the status directly.",
  CHECKED_OUT: "Use the Check-Out action instead of setting the status directly — it settles the folio balance.",
};

// Thrown inside the transition transaction when the reservation's status changed between
// the read and the write (a concurrent transition already ran) — turned into a clean 409
// rather than posting a cancellation fee / reopening folios twice.
class StatusConflict extends Error {}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");

    const { id } = await params;
    const body = await request.json();

    if (!body.status) {
      return NextResponse.json({ error: "Missing status field" }, { status: 400 });
    }

    const validStatuses = Object.values(ReservationStatus);
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const existing = await prisma.reservation.findUnique({
      where: { id },
      include: {
        property: { select: { businessDate: true, enterpriseId: true, pricesIncludeTaxes: true } },
        assignments: true,
        folios: { include: { lineItems: true, payments: true } },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.propertyId);

    if (body.status === existing.status) {
      return NextResponse.json(existing); // no-op
    }

    const allowed = ALLOWED_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(body.status)) {
      const hint = TRANSITION_HINTS[body.status];
      return NextResponse.json(
        {
          error: `Cannot change a ${existing.status} reservation to ${body.status}.${hint ? ` ${hint}` : ""}`,
        },
        { status: 400 }
      );
    }

    // Cancellation fee handling. When an active per-property CANCELLATION rule
    // applies, cancellation PROCEEDS and the computed fee is posted to the folio
    // (retaining any held deposit against it) — the fee is a rule-driven system
    // posting, not a manual billing charge. Otherwise cancellation keeps the
    // zero-balance guard: it's only allowed once the folios net to ~zero, so it can
    // never silently orphan real money. (NO_SHOW is never blocked this way.)
    let cancellationRule: Awaited<ReturnType<typeof getFeeRuleById>> = null;
    let cancellationFee = 0;
    if (body.status === "CANCELLED") {
      cancellationRule = await getFeeRuleById(existing.cancellationFeeRuleId, "CANCELLATION");
      if (cancellationRule && cancellationRule.chargeCodeId) {
        cancellationFee = await computeReservationFee(cancellationRule, existing);
      }
      if (cancellationFee <= 0.005) {
        // No applicable fee → require a net-zero folio before cancelling.
        let chargeCents = 0;
        let paymentCents = 0;
        for (const f of existing.folios) {
          for (const li of f.lineItems) {
            if (!li.isVoid) chargeCents += toCents(li.amount) + toCents(li.taxAmount) + toCents(li.serviceChargeAmount);
          }
          for (const p of f.payments) {
            paymentCents += p.isRefund ? -toCents(p.amount) : toCents(p.amount);
          }
        }
        const balance = fromCents(chargeCents - paymentCents);
        if (Math.abs(balance) > 0.01) {
          return NextResponse.json(
            {
              error:
                "Cannot cancel: this reservation's folio has an unsettled balance. Settle or void the charges (and refund any deposit) first.",
              balance,
            },
            { status: 400 }
          );
        }
      }
    }

    // Reinstating (CANCELLED/NO_SHOW → RESERVED) is date-bounded by the stay itself:
    //  - a CANCELLED booking can only come back while its arrival is still in the future
    //    (a past arrival is a fresh booking, not a reinstatement);
    //  - a NO_SHOW can come back only while still within the stay period (business date
    //    on or before departure) — once the departure date has passed there's nothing to
    //    reinstate into.
    if (body.status === "RESERVED") {
      const bd = toUtcMidnight(resolveBusinessDate(existing.property)).getTime();
      const arrival = toUtcMidnight(new Date(existing.checkInDate)).getTime();
      const departure = toUtcMidnight(new Date(existing.checkOutDate)).getTime();
      if (existing.status === "CANCELLED" && arrival <= bd) {
        return NextResponse.json(
          { error: "This reservation can't be reinstated — its arrival date is no longer in the future. Create a new booking instead." },
          { status: 400 }
        );
      }
      if (existing.status === "NO_SHOW" && bd > departure) {
        return NextResponse.json(
          { error: "This no-show can't be reinstated — the stay's departure date has already passed." },
          { status: 400 }
        );
      }
    }

    // Reinstating also puts the reservation back into sellable inventory — the rooms may
    // have been resold in the meantime, so it must pass the same availability guard as a
    // fresh booking.
    if (body.status === "RESERVED") {
      const conflicts = await findTypeAvailabilityConflicts({
        propertyId: existing.propertyId,
        segments: existing.assignments.map((a) => ({
          roomTypeId: a.roomTypeId,
          startDate: a.startDate,
          endDate: a.endDate,
        })),
        excludeReservationId: id,
      });
      if (conflicts.length > 0) {
        return NextResponse.json(
          { error: `Cannot reinstate — ${conflicts.join("; ")}` },
          { status: 409 }
        );
      }
    }

    // Stamp the lifecycle timestamps so the Cancellations & No-Shows report can
    // filter by when it happened / show the reason; clear them on reinstate.
    const now = new Date();
    const statusData: Record<string, unknown> = { status: body.status };
    if (body.status === "CANCELLED") {
      statusData.cancelledAt = now;
      statusData.cancellationReason =
        typeof body.reason === "string" && body.reason.trim() ? body.reason.trim()
        : typeof body.cancellationReason === "string" && body.cancellationReason.trim() ? body.cancellationReason.trim()
        : null;
    } else if (body.status === "NO_SHOW") {
      statusData.noShowAt = now;
    } else if (body.status === "RESERVED") {
      statusData.cancelledAt = null;
      statusData.cancellationReason = null;
      statusData.noShowAt = null;
    }

    let updatedReservation;
    try {
    updatedReservation = await prisma.$transaction(async (tx) => {
      // Conditional on the status observed above still being current, so two concurrent
      // transitions can't both post a cancellation fee / reopen folios — the loser
      // matches 0 rows and aborts.
      const claimed = await tx.reservation.updateMany({
        where: { id, status: existing.status },
        data: statusData,
      });
      if (claimed.count === 0) throw new StatusConflict();
      const updated = await tx.reservation.findUnique({ where: { id } });

      // A cancelled reservation's folios are closed so they can't accumulate
      // charges; reinstating reopens them. When a cancellation fee applies, post it
      // (retaining any held deposit) before closing.
      if (body.status === "CANCELLED") {
        if (cancellationRule?.chargeCodeId && cancellationFee > 0.005) {
          let folio = existing.folios.find((f) => !f.isClosed) ?? existing.folios[0];
          if (!folio) {
            folio = await tx.folio.create({
              data: { reservationId: id, propertyId: existing.propertyId, folioNumber: 1 },
              include: { lineItems: true, payments: true },
            });
          }
          // Through the one posting service, so the fee's charge code taxes and
          // generates like any other charge. The rule's amount is treated the same way
          // every other configured price in the app is — gross or net per the property's
          // "Prices Include Taxes" setting — so the guest is charged the amount that was
          // configured, split into net + GST rather than posted untaxed.
          const feeCode = await tx.chargeCode.findUniqueOrThrow({
            where: { id: cancellationRule.chargeCodeId },
            include: chargeCodeInclude(),
          });
          const feeSettings = await tx.enterpriseSettings.findUnique({
            where: { enterpriseId: existing.property.enterpriseId },
          });
          await postCharge(tx, {
            folioId: folio.id,
            chargeCode: feeCode,
            inputAmount: cancellationFee,
            settings: feeSettings,
            pricesIncludeTaxes: existing.property.pricesIncludeTaxes,
            date: resolveBusinessDate(existing.property),
            description: "Cancellation fee",
          });
        }
        await tx.folio.updateMany({
          where: { reservationId: id, isClosed: false },
          data: { isClosed: true },
        });
        // A cancelled stay has nothing left to self check-in for — revoke any active
        // eRegistration link so an already-open guest tab stops accepting submissions.
        await tx.eRegistrationLink.updateMany({
          where: { reservationId: id, status: "ACTIVE" },
          data: { status: "REVOKED", revokedAt: new Date(), revokedByUserId: ctx.userId },
        });
      } else if (body.status === "NO_SHOW") {
        await tx.eRegistrationLink.updateMany({
          where: { reservationId: id, status: "ACTIVE" },
          data: { status: "REVOKED", revokedAt: new Date(), revokedByUserId: ctx.userId },
        });
      } else if (body.status === "RESERVED") {
        await tx.folio.updateMany({
          where: { reservationId: id, isDebtorAccount: false },
          data: { isClosed: false },
        });
      }

      return updated;
    });
    } catch (txError) {
      if (txError instanceof StatusConflict) {
        return NextResponse.json({ error: "This reservation's status was just changed by another action." }, { status: 409 });
      }
      throw txError;
    }

    // Reconciliation for a cancellation fee: the fee is now posted; net it against
    // any deposit already held so the UI can prompt to collect a shortfall or
    // refund a remainder.
    let cancellationFeeInfo: { fee: number; depositHeld: number; refundDue: number; shortfall: number } | null = null;
    if (body.status === "CANCELLED" && cancellationFee > 0.005) {
      const depositHeld = fromCents(
        existing.folios.flatMap((f) => f.payments).reduce((c, p) => c + (p.isRefund ? -toCents(p.amount) : toCents(p.amount)), 0)
      );
      const net = subMoney(cancellationFee, depositHeld);
      cancellationFeeInfo = {
        fee: cancellationFee,
        depositHeld,
        refundDue: Math.max(0, -net),
        shortfall: Math.max(0, net),
      };
    }

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: body.status,
      entityType: "Reservation",
      entityId: id,
      description: `Reservation ${existing.confirmationNo}: ${existing.status} → ${body.status}` +
        (cancellationFeeInfo ? ` — cancellation fee $${cancellationFeeInfo.fee.toFixed(2)} posted` : ""),
    });

    return NextResponse.json({ ...updatedReservation, ...(cancellationFeeInfo ? { cancellationFee: cancellationFeeInfo } : {}) });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
