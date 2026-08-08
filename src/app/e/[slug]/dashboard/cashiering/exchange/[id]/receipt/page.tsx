"use client"

import { useEffect, useState, use } from "react"
import { format, parseISO } from "date-fns"
import { resolveStationeryBrand } from "@/lib/stationery-brand"
import { PrintDocumentShell, PrintLoading, PrintError } from "@/components/print/print-document-shell"
import { ReceiptDocument } from "@/components/print/stationery/documents"
import type { StationeryRow, MetaItem } from "@/components/print/stationery/blocks"
import { Button } from "@/components/ui/button"
import { Mail } from "@/components/icons"
import { EmailDocumentDialog } from "@/components/print/email-document-dialog"

export default function CurrencyExchangeReceiptPage({ params }: { params: Promise<{ id: string; slug: string }> }) {
  const { id, slug } = use(params)

  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [emailOpen, setEmailOpen] = useState(false)

  const fetchReceiptData = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/cashiering/currency-exchange/${id}/receipt-data`)
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
  if (error || !data) return <PrintError message={error || "Currency exchange not found"} />

  const { exchange, settings } = data

  const brand = resolveStationeryBrand(exchange.property)

  const rows: StationeryRow[] = [{
    date: format(parseISO(exchange.createdAt), "dd-MMM-yy"),
    description: `Exchange ${exchange.fromCurrency} → ${exchange.toCurrency} @ ${exchange.rate}`,
    reference: exchange.fromCurrency,
    amount: exchange.amountFrom,
  }]

  const paymentDetails: MetaItem[] = [
    { label: "Rate", value: `1 ${exchange.fromCurrency} = ${exchange.rate} ${exchange.toCurrency}` },
    { label: "Amount Given", value: `${exchange.amountFrom.toFixed(2)} ${exchange.fromCurrency}` },
  ]

  const meta: MetaItem[] = [
    { label: "Receipt No", value: exchange.receiptNumber || "—" },
    { label: "Date", value: format(parseISO(exchange.createdAt), "dd-MMM-yy") },
  ]

  return (
    <PrintDocumentShell
      previewLabel="Currency Exchange Receipt Preview"
      fontClassName={brand.fontClass}
      printLabel="Download PDF"
      onPrint={() => window.open(`/api/cashiering/currency-exchange/${id}/send-receipt?slug=${slug}`, "_blank")}
      extraActions={
        <Button variant="outline" onClick={() => setEmailOpen(true)}>
          <Mail className="w-4 h-4 mr-2" /> Email
        </Button>
      }
    >
      <ReceiptDocument
        brand={brand}
        kind="exchange"
        meta={meta}
        receivedFrom={exchange.guestName || "Walk-in Customer"}
        paymentDetails={paymentDetails}
        rows={rows}
        amountLabel={`Amount Received (${exchange.toCurrency})`}
        amount={exchange.amountTo}
        currency={exchange.toCurrency}
        terms={settings.receiptTerms}
        footerNote={settings.receiptFooterText}
      />

      <EmailDocumentDialog
        open={emailOpen}
        onOpenChange={setEmailOpen}
        profileUpid={undefined}
        documentLabel="Currency Exchange Receipt"
        onSend={(email) =>
          fetch(`/api/cashiering/currency-exchange/${id}/send-receipt`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, slug }),
          }).then(async (res) => (res.ok ? { ok: true } : { ok: false, error: (await res.json()).error }))
        }
      />
    </PrintDocumentShell>
  )
}
