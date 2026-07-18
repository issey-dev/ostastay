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

export default function CurrencyExchangeReceiptPage({ params }: { params: Promise<{ id: string; slug: string }> }) {
  const { id } = use(params)

  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  const brandColor = resolveInvoiceBrandColor(settings.invoiceBrandColor)
  const fontClassName = resolvePrintFontClass(settings.invoiceFontFamily)

  const exchangeRows: PrintTransactionRow[] = [{
    date: format(parseISO(exchange.createdAt), "dd-MMM-yy"),
    description: `Exchange ${exchange.fromCurrency} → ${exchange.toCurrency} @ ${exchange.rate}`,
    reference: exchange.fromCurrency,
    amount: exchange.amountFrom,
  }]

  const guestLines = [
    exchange.guestName || "Walk-in Customer",
  ]

  const exchangeLines = [
    `Rate: 1 ${exchange.fromCurrency} = ${exchange.rate} ${exchange.toCurrency}`,
    `Amount Given: ${exchange.amountFrom.toFixed(2)} ${exchange.fromCurrency}`,
  ]

  return (
    <PrintDocumentShell
      previewLabel={`Currency Exchange Receipt Preview`}
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
        title="Exchange Receipt"
        metaRows={[
          { label: "Receipt No", value: exchange.receiptNumber || "—" },
          { label: "Date", value: format(parseISO(exchange.createdAt), "dd-MMM-yy") },
        ]}
      />

      <PrintInfoColumns
        columns={[
          { heading: "Customer", lines: guestLines },
          { heading: "Exchange Details", lines: exchangeLines },
        ]}
      />

      <div className="mb-2">
        <PrintTransactionTable rows={exchangeRows} brandColor={brandColor} />
      </div>

      <PrintTotals
        lines={[
          { label: `Amount Given (${exchange.fromCurrency})`, amount: exchange.amountFrom },
        ]}
        balanceLabel={`Amount Received (${exchange.toCurrency})`}
        balanceAmount={exchange.amountTo}
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
