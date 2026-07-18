"use client"

import { useEffect, useState, use } from "react"
import { format, parseISO } from "date-fns"
import { resolveInvoiceBrandColor } from "@/lib/invoice-branding"
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

export default function PaymentReceiptPage({ params }: { params: Promise<{ id: string; slug: string }> }) {
  const { id } = use(params)

  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchReceiptData = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/payments/${id}/receipt-data`)
      if (res.ok) {
        const json = await res.json()
        setData(json)
        setTimeout(() => window.print(), 1000)
      } else {
        setError("Failed to load receipt data.")
      }
    } catch (e) {
      console.error(e)
      setError("An unexpected error occurred.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchReceiptData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (loading) return <PrintLoading label="Preparing printable receipt..." />
  if (error || !data) return <PrintError message={error || "Payment not found"} />

  const { payment, settings } = data
  const { folio } = payment
  const { reservation, payeeProfile } = folio

  const guest = payeeProfile || reservation?.primaryGuest || {
    firstName: folio.walkInGuestName || "Walk-in Guest",
    lastName: "",
    contacts: folio.walkInGuestContact ? [{ mobile: folio.walkInGuestContact }] : []
  }

  let folioBalance = 0
  folio.lineItems.forEach((i: any) => {
    if (!i.isVoid) {
      folioBalance += i.amount + (i.serviceChargeAmount || 0) + i.taxAmount
    }
  })
  folio.payments.forEach((p: any) => {
    folioBalance += p.isRefund ? p.amount : -p.amount
  })

  const brandColor = resolveInvoiceBrandColor(settings.invoiceBrandColor)
  const fontClassName = resolvePrintFontClass(settings.invoiceFontFamily)

  const paymentRows: PrintTransactionRow[] = [{
    date: format(parseISO(payment.createdAt), "dd-MMM-yy"),
    description: `${payment.isRefund ? "Refund" : "Payment"} - ${payment.paymentMethod?.name || ""}`,
    reference: payment.referenceNumber,
    amount: payment.isRefund ? -payment.amount : payment.amount,
  }]

  const guestLines = [
    `${guest.firstName} ${guest.lastName}`.trim(),
    guest.contacts?.[0]?.email ? `Email: ${guest.contacts[0].email}` : "",
    guest.contacts?.[0]?.mobile ? `Phone: ${guest.contacts[0].mobile}` : "",
  ]

  const paymentLines = [
    `Method: ${payment.paymentMethod?.name || "—"}`,
    payment.referenceNumber ? `Reference: ${payment.referenceNumber}` : "",
  ]

  return (
    <PrintDocumentShell
      previewLabel={`Payment Receipt Preview for ${reservation ? `#${reservation.confirmationNo}` : "Walk-in Sale"}`}
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
        title="Payment Receipt"
        metaRows={[
          { label: "Receipt No", value: payment.receiptNumber || "—" },
          { label: "Date", value: format(parseISO(payment.createdAt), "dd-MMM-yy") },
          { label: "Folio No", value: String(folio.folioNumber) },
        ]}
      />

      <PrintInfoColumns
        columns={[
          { heading: "Guest Information", lines: guestLines },
          { heading: "Payment Details", lines: paymentLines },
        ]}
      />

      <div className="mb-2">
        <PrintTransactionTable rows={paymentRows} brandColor={brandColor} />
      </div>

      <PrintTotals
        lines={[
          { label: payment.isRefund ? "Amount Refunded" : "Amount Received", amount: payment.amount, emphasis: true },
        ]}
        balanceLabel="Remaining Folio Balance"
        balanceAmount={folioBalance}
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
