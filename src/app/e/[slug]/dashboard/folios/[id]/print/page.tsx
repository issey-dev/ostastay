"use client"

import { useEffect, useState, use } from "react"
import { useSearchParams } from "next/navigation"
import { format, parseISO } from "date-fns"
import { resolveInvoiceBrandColor } from "@/lib/invoice-branding"
import { primaryEmail, primaryMobile } from "@/lib/profile-communications"
import {
  PrintDocumentShell,
  PrintLoading,
  PrintError,
  resolvePrintFontClass,
} from "@/components/print/print-document-shell"
import {
  PrintDocumentHeader,
  PrintInfoColumns,
  PrintTransactionTable,
  PrintTotals,
  PrintFooter,
  type PrintTransactionRow,
} from "@/components/print/print-blocks"

export default function PrintInvoicePage({ params }: { params: Promise<{ id: string; slug: string }> }) {
  const { id } = use(params)
  const searchParams = useSearchParams()
  const documentTypeParam: "tax" | "proforma" = searchParams.get("type") === "proforma" ? "proforma" : "tax"

  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchInvoiceData = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/folios/${id}/invoice-data?type=${documentTypeParam}`)
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
  }, [id, documentTypeParam])

  if (loading) return <PrintLoading label="Preparing printable invoice..." />
  if (error || !data) return <PrintError message={error || "Folio not found"} />

  const { folio, settings, documentType } = data
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
      if (i.chargeCode?.code === 'GTX' || i.description.includes('Green Tax')) {
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

  const brandColor = resolveInvoiceBrandColor(settings.invoiceBrandColor)
  const fontClassName = resolvePrintFontClass(settings.invoiceFontFamily)

  const isTax = documentType === "tax"
  const documentNumber = isTax ? folio.taxInvoiceNumber : folio.proformaInvoiceNumber
  const title = isTax ? "Tax Invoice" : "Proforma Invoice"
  const disclaimer = isTax ? undefined : "This is not a tax invoice."

  const chargeRows: PrintTransactionRow[] = folio.lineItems
    .filter((item: any) => !item.isVoid)
    .map((item: any) => ({
      date: format(parseISO(item.date), "dd-MMM-yy"),
      description: item.description,
      reference: item.chargeCode?.code,
      amount: item.amount + (item.serviceChargeAmount || 0) + item.taxAmount,
    }))

  const paymentRows: PrintTransactionRow[] = folio.payments.map((payment: any) => ({
    date: format(parseISO(payment.createdAt), "dd-MMM-yy"),
    description: `Payment - ${payment.paymentMethod?.name || ""}`,
    reference: payment.referenceNumber,
    amount: payment.isRefund ? -payment.amount : payment.amount,
  }))

  const nights = reservation
    ? Math.max(1, Math.round((new Date(reservation.checkOutDate).getTime() - new Date(reservation.checkInDate).getTime()) / (1000 * 3600 * 24)))
    : null

  const stayLines = reservation
    ? [
        `Check-In: ${format(parseISO(reservation.checkInDate), "dd-MMM-yy")}`,
        `Check-Out: ${format(parseISO(reservation.checkOutDate), "dd-MMM-yy")}`,
        `Total Nights: ${nights}`,
        `Rooms: ${reservation.assignments?.map((a: any) => a.room?.roomNumber).filter(Boolean).join(", ") || "TBA"}`,
      ]
    : ["Walk-in / Outlet Sale — no room booking"]

  const invoiceGuestEmail = primaryEmail(invoiceGuest.communications)
  const invoiceGuestMobile = primaryMobile(invoiceGuest.communications)
  const guestLines = [
    `${invoiceGuest.firstName} ${invoiceGuest.lastName}`.trim(),
    invoiceGuestEmail ? `Email: ${invoiceGuestEmail}` : "",
    invoiceGuestMobile ? `Phone: ${invoiceGuestMobile}` : "",
  ]

  return (
    <PrintDocumentShell
      previewLabel={`${title} Preview for ${reservation ? `#${reservation.confirmationNo}` : "Walk-in Sale"}`}
      fontClassName={fontClassName}
    >
      <PrintDocumentHeader
        brandName={settings.invoiceBrandName || "Main Guest House"}
        logoUrl={settings.invoiceLogoUrl}
        address={settings.invoiceAddress}
        phone={settings.invoicePhone}
        email={settings.invoiceEmail}
        taxId={settings.invoiceTaxId}
        brandColor={brandColor}
        title={title}
        disclaimer={disclaimer}
        metaRows={[
          { label: isTax ? "Invoice No" : "Proforma No", value: documentNumber || "—" },
          ...(reservation ? [{ label: "Confirmation No", value: reservation.confirmationNo }] : []),
          { label: "Date", value: format(new Date(), "dd-MMM-yy") },
          { label: "Folio No", value: String(folio.folioNumber) },
        ]}
      />

      {settings.invoiceHeaderText && (
        <div className="bg-slate-50 p-4 rounded border border-slate-100 text-xs text-slate-600 mb-6 whitespace-pre-line leading-relaxed">
          {settings.invoiceHeaderText}
        </div>
      )}

      <PrintInfoColumns
        columns={[
          { heading: "Guest Information", lines: guestLines },
          { heading: reservation ? "Stay Summary" : "Sale Type", lines: stayLines },
        ]}
      />

      {reservation?.assignments && reservation.assignments.length > 1 && (
        <div className="mb-8">
          <h3 className="font-bold text-slate-500 uppercase tracking-wider text-[10px] mb-2">Room Stay Assignments</h3>
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-xs text-slate-700">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-left p-2 font-semibold">Room Number</th>
                  <th className="text-left p-2 font-semibold">Room Type</th>
                  <th className="text-right p-2 font-semibold">Dates</th>
                </tr>
              </thead>
              <tbody>
                {reservation.assignments.map((a: any) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="p-2 font-semibold">Room {a.room?.roomNumber || "TBA"}</td>
                    <td className="p-2">{a.roomType.name}</td>
                    <td className="p-2 text-right text-slate-500">
                      {format(parseISO(a.startDate), "dd-MMM")} - {format(parseISO(a.endDate), "dd-MMM-yy")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mb-2">
        <h3 className="font-bold text-slate-500 uppercase tracking-wider text-[10px] mb-2">Charges</h3>
        <PrintTransactionTable rows={chargeRows} brandColor={brandColor} emptyLabel="No charges posted." />
      </div>

      <div className="mb-2">
        <h3 className="font-bold text-slate-500 uppercase tracking-wider text-[10px] mb-2">Payments & Credits</h3>
        <PrintTransactionTable rows={paymentRows} brandColor={brandColor} emptyLabel="No payments recorded." />
      </div>

      <PrintTotals
        lines={[
          { label: "Subtotal Charges", amount: totalBaseCharges },
          ...(settings.serviceChargeEnabled && totalServiceCharges > 0 ? [{ label: `Service Charge (${settings.serviceChargeRate}%)`, amount: totalServiceCharges }] : []),
          ...(settings.tgstEnabled && totalTaxes > 0 ? [{ label: `TGST (${settings.tgstRate}%)`, amount: totalTaxes }] : []),
          ...(settings.greenTaxEnabled && totalGreenTax > 0 ? [{ label: "Green Tax", amount: totalGreenTax }] : []),
          { label: "Total Paid", amount: totalPayments, emphasis: true },
        ]}
        balanceLabel="Net Balance Due"
        balanceAmount={balance}
        brandColor={brandColor}
      />

      <PrintFooter
        paymentInfo={{
          accountName: settings.invoicePaymentAccountName,
          accountNumber: settings.invoicePaymentAccountNumber,
          iban: settings.invoicePaymentIban,
          bankInfo: settings.invoicePaymentBankInfo,
        }}
        terms={settings.invoicePaymentTerms}
        closingText={settings.invoiceFooterText}
      />
    </PrintDocumentShell>
  )
}
