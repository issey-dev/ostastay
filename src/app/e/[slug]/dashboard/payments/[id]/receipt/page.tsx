"use client"

import { useEffect, useState, use } from "react"
import { format, parseISO } from "date-fns"
import { primaryEmail, primaryMobile } from "@/lib/profile-communications"
import { resolveStationeryBrand } from "@/lib/stationery-brand"
import { PrintDocumentShell, PrintLoading, PrintError } from "@/components/print/print-document-shell"
import { ReceiptDocument } from "@/components/print/stationery/documents"
import type { StationeryRow, MetaItem } from "@/components/print/stationery/blocks"

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

  const brand = resolveStationeryBrand(folio.property)
  const currency = folio.property.defaultCurrency || "USD"

  const rows: StationeryRow[] = [{
    date: format(parseISO(payment.createdAt), "dd-MMM-yy"),
    description: `${payment.isRefund ? "Refund" : "Payment"} — ${payment.paymentMethod?.name || ""}`,
    reference: payment.referenceNumber,
    amount: payment.isRefund ? -payment.amount : payment.amount,
  }]

  const guestEmail = primaryEmail(guest.communications)
  const guestMobile = primaryMobile(guest.communications)
  const receivedFrom = `${guest.firstName} ${guest.lastName}`.trim() || "Guest"

  const paymentDetails: MetaItem[] = [
    { label: "Method", value: payment.paymentMethod?.name || "—" },
    ...(payment.referenceNumber ? [{ label: "Reference", value: payment.referenceNumber }] : []),
    ...(guestEmail ? [{ label: "Email", value: guestEmail }] : []),
    ...(guestMobile ? [{ label: "Phone", value: guestMobile }] : []),
  ]

  const meta: MetaItem[] = [
    { label: "Receipt No", value: payment.receiptNumber || "—" },
    { label: "Date", value: format(parseISO(payment.createdAt), "dd-MMM-yy") },
    { label: "Folio No", value: String(folio.folioNumber) },
  ]

  return (
    <PrintDocumentShell
      previewLabel={`Payment Receipt Preview for ${reservation ? `#${reservation.confirmationNo}` : "Walk-in Sale"}`}
      fontClassName={brand.fontClass}
    >
      <ReceiptDocument
        brand={brand}
        kind="payment"
        meta={meta}
        receivedFrom={receivedFrom}
        paymentDetails={paymentDetails}
        rows={rows}
        amountLabel={payment.isRefund ? "Amount Refunded" : "Amount Received"}
        amount={payment.amount}
        currency={currency}
        remainingLabel="Remaining folio balance"
        remainingAmount={folioBalance}
        terms={settings.receiptTerms}
        footerNote={settings.receiptFooterText}
      />
    </PrintDocumentShell>
  )
}
