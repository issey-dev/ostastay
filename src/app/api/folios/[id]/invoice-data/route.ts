import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DEFAULT_INVOICE_BRAND_COLOR } from "@/lib/invoice-branding";
import { requireSession, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { allocateSequenceNumber } from "@/lib/document-sequence";
import { computeReservationQuote } from "@/lib/reservation-quote-server";
import { resolveChargeTax } from "@/lib/tax-calc";
import { resolveChargeCode } from "@/lib/posting/resolve-charge-code";

const INVOICE_INCLUDE = {
  lineItems: {
    include: {
      chargeCode: true,
      // The outlet sales check a line was posted under, if any — its number is shown in
      // the Reference column of a guest-house invoice so room-posted outlet charges point
      // back to the outlet's own check.
      outletCheck: { select: { checkNumber: true } }
    }
  },
  payments: {
    include: {
      paymentMethod: true
    }
  },
  payeeProfile: {
    include: {
      communications: true
    }
  },
  property: true,
  reservation: {
    include: {
      primaryGuest: {
        include: {
          communications: true
        }
      },
      assignments: {
        include: {
          room: true,
          roomType: true
        },
        orderBy: {
          startDate: 'asc' as const
        }
      },
      transports: true
    }
  }
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    const { id } = await params;

    const url = new URL(request.url);
    // "interim" is a mid-stay information bill — the actually-posted lines + payments so
    // far (like the tax invoice) but NOT a legal document: it allocates no number and
    // makes no ledger change. "proforma" is the full projected estimate; "tax" is final.
    const typeParam = url.searchParams.get("type");
    const documentType: "tax" | "proforma" | "interim" =
      typeParam === "proforma" ? "proforma" : typeParam === "interim" ? "interim" : "tax";

    // 1. Fetch Folio details with relations
    let folio = await prisma.folio.findUnique({
      where: { id },
      include: INVOICE_INCLUDE
    });

    if (!folio) {
      return NextResponse.json({ error: "Folio not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, folio.propertyId);

    // Before the guest checks in, the only document that exists is a quote. A tax invoice
    // and an interim bill both report POSTED charges, and nothing can be posted to a
    // reservation folio pre-arrival (owner rule, 2026-08-03) — so both would render an
    // empty document, and the tax invoice would additionally burn a fiscal sequence
    // number against a stay that may never happen. Checked here, not just in the panel,
    // because the print page is a plain URL anyone could hit directly.
    if (
      documentType !== "proforma" &&
      folio.reservation &&
      folio.reservation.status !== "IN_HOUSE" &&
      folio.reservation.status !== "CHECKED_OUT"
    ) {
      return NextResponse.json(
        {
          error:
            "A tax invoice or interim bill can only be raised once the guest has checked in. Use the Proforma Invoice for a pre-arrival quote.",
        },
        { status: 400 }
      );
    }

    // Assign a document number the first time this document type is generated for this
    // folio, via the property's Sequence Manager counter — reprints reuse the stored
    // number instead of allocating a new one. The Interim bill is informational and never
    // numbered.
    const existingNumber = documentType === "tax" ? folio.taxInvoiceNumber : folio.proformaInvoiceNumber;
    if (documentType !== "interim" && !existingNumber) {
      const sequenceType = documentType === "tax" ? "TAX_INVOICE" : "PROFORMA_FOLIO";
      const nextValue = await allocateSequenceNumber(folio.propertyId, sequenceType);
      const prefix = documentType === "tax" ? "INV" : "PRO";
      const documentNumber = `${prefix}-${String(nextValue).padStart(5, "0")}`;
      folio = await prisma.folio.update({
        where: { id: folio.id },
        data: documentType === "tax" ? { taxInvoiceNumber: documentNumber } : { proformaInvoiceNumber: documentNumber },
        include: INVOICE_INCLUDE
      });
    }

    // 2. Fetch Enterprise settings for invoice branding, derived from the folio's own
    // property → enterprise (not a hardcoded constant) — works the same for a
    // reservation-backed folio or a walk-in one, since propertyId is always present.
    const enterpriseId = folio.property.enterpriseId;
    let settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId }
    });

    // Default settings fallback
    if (!settings) {
      settings = {
        id: "default",
        enterpriseId,
        resConfirmPrefix: "",
        resConfirmLength: 6,
        cashierDefaultFloat: 300,
        exchangeFromCurrency: "USD",
        exchangeToCurrency: "MVR",
        systemDate: new Date(),
        defaultAccommodationChargeCodeId: null,
        defaultGreenTaxChargeCodeId: null,
        cityLedgerPaymentMethodId: null,
        commissionChargeCodeId: null,
        invoiceBrandName: "Cozy Guest House",
        invoiceLogoUrl: "",
        invoiceBrandColor: DEFAULT_INVOICE_BRAND_COLOR,
        invoiceFontFamily: "Geist",
        invoiceTaxId: "",
        invoicePhone: "",
        invoiceEmail: "",
        invoiceAddress: "",
        defaultFolioStyle: "detailed",
        invoiceHeaderText: "",
        invoiceFooterText: "Thank you for staying with us!",
        invoicePaymentTerms: "Payment is due immediately upon check-out.",
        invoicePaymentAccountName: null,
        invoicePaymentAccountNumber: null,
        invoicePaymentIban: null,
        invoicePaymentBankInfo: null,
        receiptFooterText: null,
        receiptTerms: null,
        statementFooterText: null,
        statementTerms: null,
        confirmationLetterMessage: null,
        registrationCardEnabled: true,
        eRegistrationEnabled: true,
        spaOutletId: null,
        excursionOutletId: null,
        eRegistrationExpiryHours: 72,
        eRegistrationMessage: null,
        registrationCardMessage: null,
        registrationCardTerms: null,
        greenTaxEnabled: true,
        greenTaxAdultAmount: 12.00,
        greenTaxChildAmount: 6.00,
        greenTaxExemptAge: 2,
        tgstEnabled: true,
        tgstRate: 17.00,
        serviceChargeEnabled: true,
        serviceChargeRate: 10.00,
        smtpHost: null,
        smtpPort: null,
        smtpUsername: null,
        smtpPassword: null,
        smtpFromAddress: null,
        smtpUseTls: true,
        sftpHost: null,
        sftpPort: null,
        sftpUsername: null,
        sftpPassword: null,
        sftpRemotePath: null,
        updatedAt: new Date()
      };
    }

    // A Proforma quotes the FULL expected cost of the stay — not just whatever has
    // been posted so far (which is empty before/early in a stay, hence the old blank
    // proforma). Rebuild its line items from the reservation quote engine (the same
    // room/tax/green-tax/allocation resolution Night Audit posts with) so the guest
    // sees the whole projected bill. The Tax Invoice still shows actually-posted lines.
    let responseFolio: any = folio;
    if (documentType === "proforma" && folio.reservation && folio.reservation.assignments.length > 0) {
      const reservation = folio.reservation;
      const manualAllocations = await prisma.reservationAllocation.findMany({
        where: { reservationId: reservation.id, source: "MANUAL" },
        select: { allocationId: true },
      });
      try {
        const quote = await computeReservationQuote({
          propertyId: folio.propertyId,
          assignments: reservation.assignments.map((a) => ({
            roomTypeId: a.roomTypeId,
            ratePlanId: a.ratePlanId,
            startDate: a.startDate,
            endDate: a.endDate,
            overrideRate: a.overrideRate,
          })),
          adults: reservation.adults,
          children: reservation.children,
          mealPlanCode: reservation.mealPlan,
          manualAllocationIds: manualAllocations.map((m) => m.allocationId),
        });

        const roomTypeName = new Map(reservation.assignments.map((a) => [a.roomTypeId, a.roomType?.name ?? "Accommodation"]));
        const proformaLines: any[] = [];
        let i = 0;

        // The proforma's lines are projections, not postings — but the code printed
        // beside each must still be the property's real one, resolved by role rather
        // than the literal "ROOM"/"GTX" this used to hardcode.
        const [accommodationCode, greenTaxCode] = await Promise.all([
          resolveChargeCode(enterpriseId, "ACCOMMODATION", { settings }),
          resolveChargeCode(enterpriseId, "GREEN_TAX", { settings }),
        ]);
        const roomCodeLabel = accommodationCode?.code ?? "1000";
        const greenTaxCodeLabel = greenTaxCode?.code ?? "8500";

        // Where each code's Service Charge and GST would post if this projection were
        // actually posted (see src/lib/posting/charge-tree.ts — tax is attached at group
        // level). The proforma has to split the same way the folio will, or the estimate
        // and the eventual bill would read differently line for line.
        const codesWithGenerates = await prisma.chargeCode.findMany({
          where: { enterpriseId },
          select: {
            code: true,
            generatesFrom: {
              where: { isActive: true, method: { in: ["SERVICE_CHARGE", "GST"] } },
              select: { method: true, generatedCode: { select: { code: true, description: true } } },
            },
          },
        });
        const taxRoutesByCode = new Map(
          codesWithGenerates.map((c) => [
            c.code,
            {
              serviceCharge: c.generatesFrom.find((g) => g.method === "SERVICE_CHARGE")?.generatedCode ?? null,
              gst: c.generatesFrom.find((g) => g.method === "GST")?.generatedCode ?? null,
            },
          ])
        );

        // Emits the projected charge plus, where the code routes them, its own Service
        // Charge and GST lines — mirroring exactly what postCharge writes, including the
        // generatedFromLineItemId link the folio styles group on.
        const line = (opts: { description: string; code: string; amount: number; tax?: number; sc?: number; date: Date }) => {
          const routes = taxRoutesByCode.get(opts.code);
          const tax = opts.tax ?? 0;
          const sc = opts.sc ?? 0;
          const routedSc = routes?.serviceCharge && Math.abs(sc) > 0.005 ? sc : 0;
          const routedGst = routes?.gst && Math.abs(tax) > 0.005 ? tax : 0;

          const parentId = `proforma-${i++}`;
          proformaLines.push({
            id: parentId,
            date: opts.date,
            description: opts.description,
            reference: null,
            amount: opts.amount,
            taxAmount: tax - routedGst,
            serviceChargeAmount: sc - routedSc,
            isVoid: false,
            generatedFromLineItemId: null,
            chargeCode: { code: opts.code, description: opts.description },
          });
          if (routedSc) {
            proformaLines.push({
              id: `proforma-${i++}`, date: opts.date,
              description: routes!.serviceCharge!.description, reference: null,
              amount: 0, taxAmount: 0, serviceChargeAmount: routedSc, isVoid: false,
              generatedFromLineItemId: parentId,
              chargeCode: routes!.serviceCharge!,
            });
          }
          if (routedGst) {
            proformaLines.push({
              id: `proforma-${i++}`, date: opts.date,
              description: routes!.gst!.description, reference: null,
              amount: 0, taxAmount: routedGst, serviceChargeAmount: 0, isVoid: false,
              generatedFromLineItemId: parentId,
              chargeCode: routes!.gst!,
            });
          }
        };

        // quote.allocations carries the ALLOCATION's own code ("BF"), not a charge code,
        // so map each to the code it actually posts against before looking up its taxes.
        const allocationChargeCode = new Map<string, string>();
        if (quote.allocations.length > 0) {
          const allocRows = await prisma.allocation.findMany({
            where: { id: { in: quote.allocations.map((al) => al.allocationId) } },
            select: { id: true, chargeCode: { select: { code: true } } },
          });
          for (const row of allocRows) {
            if (row.chargeCode?.code) allocationChargeCode.set(row.id, row.chargeCode.code);
          }
        }

        reservation.assignments.forEach((a) => {
          const seg = quote.segments.find((s) => s.roomTypeId === a.roomTypeId && s.ratePlanId === a.ratePlanId);
          if (!seg) return;
          line({
            description: `Accommodation — ${roomTypeName.get(a.roomTypeId)} (${seg.nights} night${seg.nights === 1 ? "" : "s"})`,
            code: roomCodeLabel, amount: seg.roomBase, tax: seg.roomTax, sc: seg.roomServiceCharge, date: a.startDate,
          });
        });
        const extraBase = quote.totals.extraOccupancyBase;
        if (extraBase > 0.005) {
          const extraTax = quote.segments.reduce((s, x) => s + x.extraOccupancyTax, 0);
          const extraSc = quote.segments.reduce((s, x) => s + x.extraOccupancyServiceCharge, 0);
          line({ description: "Extra Occupancy Charge", code: roomCodeLabel, amount: extraBase, tax: extraTax, sc: extraSc, date: reservation.checkInDate });
        }
        quote.allocations.forEach((al) => {
          line({ description: al.name, code: allocationChargeCode.get(al.allocationId) ?? al.code, amount: al.base, tax: al.tax, sc: al.serviceCharge, date: reservation.checkInDate });
        });
        if (quote.greenTax.enabled && quote.greenTax.total > 0.005) {
          line({ description: "Green Tax", code: greenTaxCodeLabel, amount: quote.greenTax.total, date: reservation.checkInDate });
        }

        // Hotel-booked transport — projected exactly like Daily Details so the proforma
        // reflects the pickup/dropoff charge that Night Audit will post on its date.
        const legs = (reservation.transports ?? []).filter(
          (t) => t.chargeToGuest && t.chargeAmount != null && t.chargeAmount > 0 && t.chargeCodeId
        );
        if (legs.length > 0) {
          const codeIds = [...new Set(legs.map((t) => t.chargeCodeId!).filter(Boolean))];
          const codes = await prisma.chargeCode.findMany({
            where: { id: { in: codeIds }, enterpriseId },
            include: { taxProfile: { include: { rates: true } } },
          });
          const codeMap = new Map(codes.map((c) => [c.id, c]));
          for (const leg of legs) {
            const code = codeMap.get(leg.chargeCodeId!);
            if (!code) continue;
            const t = resolveChargeTax({ chargeCode: code, inputAmount: leg.chargeAmount!, settings, pricesIncludeTaxes: folio.property.pricesIncludeTaxes });
            const dir = leg.direction === "PICKUP" ? "Pickup" : "Dropoff";
            const realizeDate = leg.transportTime ?? leg.carrierTime ?? (leg.direction === "PICKUP" ? reservation.checkInDate : reservation.checkOutDate);
            line({
              description: `Transport – ${dir}${leg.transportType ? ` (${leg.transportType})` : ""}`,
              code: code.code, amount: t.baseAmount, tax: t.taxAmount, sc: t.serviceChargeAmount, date: realizeDate,
            });
          }
        }

        // A proforma projects the FULL charges for the stay, but it keeps the real
        // payments. Blanking them (as this did) meant a guest who had already paid a
        // deposit was quoted the gross total with no sign of their money and a balance
        // they did not owe — the single most confusing thing on the document. The
        // projection replaces the charge lines only; payments are actual, and the
        // balance is now genuinely what is left to pay.
        responseFolio = { ...folio, lineItems: proformaLines };
      } catch {
        // If the quote can't be computed, fall back to the posted lines.
        responseFolio = folio;
      }
    }

    // WHOSE header the document prints under. An outlet carries its own business
    // identity (name/address/contact/tax no — Controls > Outlets), so a bill for its
    // trade can be raised on its behalf rather than the property's.
    //
    // Two ways an outlet is in the picture:
    //   * the folio IS the outlet's — a walk-in bill, which carries a check with
    //     folioId set (one check == one walk-in bill == one outlet). This still
    //     defaults to the outlet's header, as before.
    //   * the folio merely CONTAINS the outlet's charges — a guest's room folio with a
    //     spa treatment on it. That defaults to the property, since the hotel is
    //     billing, but the outlet is offered so a separate bill can be raised under it.
    //
    // `?header=` overrides either default with a specific outlet id, or "property".
    // The legal document number is still the one allocated above, whichever header wins.
    const walkInCheck = await prisma.outletCheck.findFirst({
      where: { folioId: folio.id },
      include: { outlet: { select: { id: true, name: true, address: true, email: true, phone: true, taxNo: true } } },
    });

    // Every outlet with activity on this folio, for the header picker.
    const outletsOnFolio = await prisma.outlet.findMany({
      where: {
        propertyId: folio.propertyId,
        OR: [
          { folioLineItems: { some: { folioId: folio.id } } },
          ...(walkInCheck?.outlet ? [{ id: walkInCheck.outlet.id }] : []),
        ],
      },
      select: { id: true, name: true, address: true, email: true, phone: true, taxNo: true },
      orderBy: { name: "asc" },
    });

    const headerParam = url.searchParams.get("header");
    const chosenOutlet =
      headerParam === "property"
        ? null
        : headerParam
          ? outletsOnFolio.find((o) => o.id === headerParam) ?? null
          : walkInCheck?.outlet ?? null; // no explicit choice — keep the walk-in default

    const outletHeader = chosenOutlet
      ? {
          id: chosenOutlet.id,
          name: chosenOutlet.name,
          address: chosenOutlet.address,
          email: chosenOutlet.email,
          phone: chosenOutlet.phone,
          taxNo: chosenOutlet.taxNo,
          // Only a walk-in bill has a check number to quote, and only its own.
          checkNumber: walkInCheck && walkInCheck.outlet?.id === chosenOutlet.id ? walkInCheck.checkNumber : null,
        }
      : null;

    return NextResponse.json({
      folio: responseFolio,
      settings,
      documentType,
      outletHeader,
      // What the print dialog offers as header choices, and which one is in effect.
      headerOptions: {
        propertyName: folio.property.name,
        outlets: outletsOnFolio.map((o) => ({ id: o.id, name: o.name })),
        selected: chosenOutlet?.id ?? "property",
      },
    });

  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
