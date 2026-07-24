import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DEFAULT_INVOICE_BRAND_COLOR } from "@/lib/invoice-branding";
import { requireSession, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { allocateSequenceNumber } from "@/lib/document-sequence";
import { computeReservationQuote } from "@/lib/reservation-quote-server";
import { resolveChargeTax } from "@/lib/tax-calc";

const INVOICE_INCLUDE = {
  lineItems: {
    include: {
      chargeCode: true
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
        invoiceHeaderText: "",
        invoiceFooterText: "Thank you for staying with us!",
        invoicePaymentTerms: "Payment is due immediately upon check-out.",
        invoicePaymentAccountName: null,
        invoicePaymentAccountNumber: null,
        invoicePaymentIban: null,
        invoicePaymentBankInfo: null,
        confirmationLetterMessage: null,
        registrationCardEnabled: true,
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
        const line = (opts: { description: string; code: string; amount: number; tax?: number; sc?: number; date: Date }) => ({
          id: `proforma-${i++}`,
          date: opts.date,
          description: opts.description,
          reference: null,
          amount: opts.amount,
          taxAmount: opts.tax ?? 0,
          serviceChargeAmount: opts.sc ?? 0,
          isVoid: false,
          chargeCode: { code: opts.code, description: opts.description },
        });

        reservation.assignments.forEach((a) => {
          const seg = quote.segments.find((s) => s.roomTypeId === a.roomTypeId && s.ratePlanId === a.ratePlanId);
          if (!seg) return;
          proformaLines.push(line({
            description: `Accommodation — ${roomTypeName.get(a.roomTypeId)} (${seg.nights} night${seg.nights === 1 ? "" : "s"})`,
            code: "ROOM", amount: seg.roomBase, tax: seg.roomTax, sc: seg.roomServiceCharge, date: a.startDate,
          }));
        });
        const extraBase = quote.totals.extraOccupancyBase;
        if (extraBase > 0.005) {
          const extraTax = quote.segments.reduce((s, x) => s + x.extraOccupancyTax, 0);
          const extraSc = quote.segments.reduce((s, x) => s + x.extraOccupancyServiceCharge, 0);
          proformaLines.push(line({ description: "Extra Occupancy Charge", code: "ROOM", amount: extraBase, tax: extraTax, sc: extraSc, date: reservation.checkInDate }));
        }
        quote.allocations.forEach((al) => {
          proformaLines.push(line({ description: al.name, code: al.code, amount: al.base, tax: al.tax, sc: al.serviceCharge, date: reservation.checkInDate }));
        });
        if (quote.greenTax.enabled && quote.greenTax.total > 0.005) {
          proformaLines.push(line({ description: "Green Tax", code: "GTX", amount: quote.greenTax.total, date: reservation.checkInDate }));
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
            proformaLines.push(line({
              description: `Transport – ${dir}${leg.transportType ? ` (${leg.transportType})` : ""}`,
              code: code.code, amount: t.baseAmount, tax: t.taxAmount, sc: t.serviceChargeAmount, date: realizeDate,
            }));
          }
        }

        // A proforma is an estimate — show the full projected charges with nothing
        // yet applied against them (deposits/payments belong on the tax invoice).
        responseFolio = { ...folio, lineItems: proformaLines, payments: [] };
      } catch {
        // If the quote can't be computed, fall back to the posted lines.
        responseFolio = folio;
      }
    }

    return NextResponse.json({
      folio: responseFolio,
      settings,
      documentType
    });

  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
