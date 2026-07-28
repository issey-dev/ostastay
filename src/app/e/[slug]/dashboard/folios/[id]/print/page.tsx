"use client"

import { useEffect, useState, use } from "react"
import { useSearchParams } from "next/navigation"
import { format, parseISO } from "date-fns"
import { primaryEmail, primaryMobile } from "@/lib/profile-communications"
import { resolveStationeryBrand } from "@/lib/stationery-brand"
import { isLevyLine } from "@/lib/posting/report-bucket"
import { buildFolioRows, isFolioStyle, FOLIO_STYLE_LABELS, type FolioStyle } from "@/lib/folio-presentation"
import { PrintDocumentShell, PrintLoading, PrintError } from "@/components/print/print-document-shell"
import { InvoiceDocument } from "@/components/print/stationery/documents"
import type { StationeryRow, StationeryTotalLine, MetaItem } from "@/components/print/stationery/blocks"

export default function PrintInvoicePage({ params }: { params: Promise<{ id: string; slug: string }> }) {
  const { id } = use(params)
  const searchParams = useSearchParams()
  const typeParam = searchParams.get("type")
  const documentTypeParam: "tax" | "proforma" | "interim" =
    typeParam === "proforma" ? "proforma" : typeParam === "interim" ? "interim" : "tax"
  // How the charges are laid out (see src/lib/folio-presentation.ts). Detailed is the
  // default: it shows every posted transaction, including each charge's own Service
  // Charge and GST lines.
  const styleParam = searchParams.get("view")
  // Whose business identity heads the document — an outlet id, or "property". Passed
  // straight through to the API, which resolves the default when it's absent.
  const headerParam = searchParams.get("header")

  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchInvoiceData = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/folios/${id}/invoice-data?type=${documentTypeParam}${headerParam ? `&header=${encodeURIComponent(headerParam)}` : ""}`)
      if (res.ok) {
        const json = await res.json()
        setData(json)
        setTimeout(() => window.print(), 1000)
      } else {
        setError("Failed to load invoice data.")
      }
    } catch (e) {
      console.error(e)
      setError("An unexpected error occurred.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchInvoiceData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, documentTypeParam, headerParam])

  if (loading) return <PrintLoading label="Preparing printable invoice..." />
  if (error || !data) return <PrintError message={error || "Folio not found"} />

  const { folio, settings, documentType, outletHeader } = data
  // An explicit ?view= wins; otherwise the property's configured default (Stationaries >
  // Invoices), so a direct link with no style still prints the way the property expects.
  const folioStyle: FolioStyle = isFolioStyle(styleParam)
    ? styleParam
    : isFolioStyle(settings?.defaultFolioStyle)
      ? settings.defaultFolioStyle
      : "detailed"
  const { reservation, payeeProfile } = folio
  // A walk-in/outlet-only folio has no reservation — fall back to the lightweight
  // guest info captured when the walk-in bill was opened.
  const invoiceGuest = payeeProfile || reservation?.primaryGuest || {
    firstName: folio.walkInGuestName || "Walk-in Guest",
    lastName: "",
    contacts: folio.walkInGuestContact ? [{ mobile: folio.walkInGuestContact }] : []
  }

  let totalBaseCharges = 0
  let totalServiceCharges = 0
  let totalTaxes = 0
  let totalGreenTax = 0
  let totalPayments = 0

  folio.lineItems.forEach((i: any) => {
    if (!i.isVoid) {
      // A government levy is broken out separately from base charges. Driven by the
      // code's postingType now, so a bed tax or municipal levy lands in the same bucket
      // instead of only a code literally named "GTX" (see report-bucket.ts's isLevyLine).
      if (isLevyLine(i.chargeCode) || i.description.includes('Green Tax')) {
        totalGreenTax += i.amount
      } else {
        totalBaseCharges += i.amount
      }
      totalServiceCharges += i.serviceChargeAmount || 0
      totalTaxes += i.taxAmount
    }
  })

  folio.payments.forEach((p: any) => {
    if (!p.isRefund) totalPayments += p.amount
    else totalPayments -= p.amount
  })

  const balance = (totalBaseCharges + totalServiceCharges + totalTaxes + totalGreenTax) - totalPayments

  // Branding identity now comes from the folio's property (name/logo/address/contact/tax +
  // accent colour + font), with the outlet override for on-behalf-of-outlet walk-in bills.
  const brand = resolveStationeryBrand(folio.property, outletHeader)
  const currency = folio.property.defaultCurrency || "USD"

  const isTax = documentType === "tax"
  const isInterim = documentType === "interim"
  const documentNumber = isTax ? folio.taxInvoiceNumber : isInterim ? null : folio.proformaInvoiceNumber
  const displayTitle = isTax ? "Tax Invoice" : isInterim ? "Interim Bill" : "Proforma Invoice"

  // Grouped per the chosen style. Every style totals to the same figure — the layout
  // changes, never what is owed. Reference falls back to the outlet sales-check number
  // then the charge code, as before.
  const chargeRows: StationeryRow[] = buildFolioRows(folio.lineItems, folioStyle).map((row) => ({
    date: format(parseISO(String(row.date)), "dd-MMM-yy"),
    description: row.count > 1 && folioStyle !== "compact" && folioStyle !== "detailed"
      ? `${row.description} (${row.count})`
      : row.description,
    reference: row.reference ?? undefined,
    amount: row.total,
  }))

  const paymentRows: StationeryRow[] = folio.payments.map((payment: any) => ({
    date: format(parseISO(payment.createdAt), "dd-MMM-yy"),
    description: `Payment - ${payment.paymentMethod?.name || ""}`,
    reference: payment.referenceNumber,
    amount: payment.isRefund ? -payment.amount : payment.amount,
  }))

  const nights = reservation
    ? Math.max(1, Math.round((new Date(reservation.checkOutDate).getTime() - new Date(reservation.checkInDate).getTime()) / (1000 * 3600 * 24)))
    : null

  const invoiceGuestEmail = primaryEmail(invoiceGuest.communications)
  const invoiceGuestMobile = primaryMobile(invoiceGuest.communications)

  const meta: MetaItem[] = [
    { label: isTax ? "Invoice No" : isInterim ? "Statement" : "Proforma No", value: documentNumber || "—" },
    ...(outletHeader ? [{ label: "Check No", value: outletHeader.checkNumber }] : []),
    ...(reservation ? [{ label: "Confirmation No", value: reservation.confirmationNo }] : []),
    { label: "Date", value: format(new Date(), "dd-MMM-yy") },
    { label: "Folio No", value: String(folio.folioNumber) },
  ]

  const billedTo = {
    name: `${invoiceGuest.firstName} ${invoiceGuest.lastName}`.trim() || "Guest",
    lines: [invoiceGuestEmail || "", invoiceGuestMobile || ""],
  }

  const staySummary: MetaItem[] = reservation
    ? [
        { label: "Check-in", value: format(parseISO(reservation.checkInDate), "dd-MMM-yy") },
        { label: "Check-out", value: format(parseISO(reservation.checkOutDate), "dd-MMM-yy") },
        { label: "Nights", value: String(nights) },
        { label: "Rooms", value: reservation.assignments?.map((a: any) => a.room?.roomNumber).filter(Boolean).join(", ") || "TBA" },
      ]
    : [{ label: "Type", value: "Walk-in / Outlet Sale" }]

  const roomAssignments =
    reservation?.assignments && reservation.assignments.length > 1
      ? reservation.assignments.map((a: any) => ({
          room: `Room ${a.room?.roomNumber || "TBA"}`,
          type: a.roomType.name,
          dates: `${format(parseISO(a.startDate), "dd-MMM")} – ${format(parseISO(a.endDate), "dd-MMM-yy")}`,
        }))
      : undefined

  const totals: StationeryTotalLine[] = [
    { label: "Subtotal Charges", amount: totalBaseCharges },
    ...(settings.serviceChargeEnabled && totalServiceCharges > 0 ? [{ label: `Service Charge (${settings.serviceChargeRate}%)`, amount: totalServiceCharges }] : []),
    ...(settings.tgstEnabled && totalTaxes > 0 ? [{ label: `TGST (${settings.tgstRate}%)`, amount: totalTaxes }] : []),
    ...(settings.greenTaxEnabled && totalGreenTax > 0 ? [{ label: "Green Tax", amount: totalGreenTax }] : []),
    { label: "Total Paid", amount: totalPayments, emphasis: true },
  ]

  return (
    <PrintDocumentShell
      previewLabel={`${displayTitle} Preview for ${reservation ? `#${reservation.confirmationNo}` : "Walk-in Sale"}`}
      fontClassName={brand.fontClass}
    >
      <InvoiceDocument
        brand={brand}
        variant={documentType}
        meta={meta}
        headerText={settings.invoiceHeaderText || null}
        billedTo={billedTo}
        staySummary={staySummary}
        staySummaryHeading={reservation ? "Stay Summary" : "Sale Type"}
        roomAssignments={roomAssignments}
        charges={chargeRows}
        payments={paymentRows}
        totals={totals}
        balanceLabel="Net Balance Due"
        balanceAmount={balance}
        currency={currency}
        paymentInfo={{
          accountName: settings.invoicePaymentAccountName,
          accountNumber: settings.invoicePaymentAccountNumber,
          iban: settings.invoicePaymentIban,
          bankInfo: settings.invoicePaymentBankInfo,
        }}
        terms={settings.invoicePaymentTerms}
        footerNote={settings.invoiceFooterText}
      />
    </PrintDocumentShell>
  )
}
