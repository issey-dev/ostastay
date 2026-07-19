"use client"

import { useEffect, useState, use } from "react"
import { format, parseISO } from "date-fns"
import { Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { resolveInvoiceBrandColor } from "@/lib/invoice-branding"
import { totalOutstanding } from "@/lib/debtor-aging"
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

export default function DebtorStatementPage({ params }: { params: Promise<{ profileId: string; slug: string }> }) {
  const { profileId } = use(params)

  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ message: string; isError?: boolean } | null>(null)

  useEffect(() => {
    // A statement isn't scoped to any single reservation — it needs the currently
    // selected property, read the same way the rest of the dashboard does.
    fetch("/api/session/current-property")
      .then((res) => (res.ok ? res.json() : null))
      .then((sess) => {
        const propertyId = sess?.currentPropertyId
        if (!propertyId) throw new Error("No property selected")
        return fetch(`/api/debtors/accounts/${profileId}/statement-data?propertyId=${propertyId}`)
      })
      .then((res) => (res && res.ok ? res.json() : Promise.reject(res)))
      .then(setData)
      .catch(() => setError("Failed to load statement data."))
      .finally(() => setLoading(false))
  }, [profileId])

  const handleSendEmail = async () => {
    setSending(true)
    setSendResult(null)
    try {
      const sess = await fetch("/api/session/current-property").then((r) => r.json())
      const res = await fetch(`/api/debtors/accounts/${profileId}/send-statement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: sess?.currentPropertyId }),
      })
      const body = await res.json()
      if (res.ok) {
        setSendResult({ message: `Sent to ${body.sentTo}.` })
      } else {
        setSendResult({ message: body.error || "Failed to send.", isError: true })
      }
    } catch {
      setSendResult({ message: "An unexpected error occurred.", isError: true })
    } finally {
      setSending(false)
      setTimeout(() => setSendResult(null), 6000)
    }
  }

  if (loading) return <PrintLoading label="Preparing statement..." />
  if (error || !data) return <PrintError message={error || "Account not found"} />

  const { profile, property, invoices, balance, aging, settings } = data
  const accountName = profile.companyName || `${profile.firstName} ${profile.lastName || ""}`.trim()

  const brandColor = resolveInvoiceBrandColor(settings?.invoiceBrandColor)
  const fontClassName = resolvePrintFontClass(settings?.invoiceFontFamily)

  const totalInvoiced = invoices.reduce((sum: number, inv: any) => sum + inv.total, 0)

  const invoiceRows: PrintTransactionRow[] = invoices.map((inv: any) => ({
    date: inv.checkOutDate ? format(parseISO(inv.checkOutDate), "dd-MMM-yy") : "—",
    description: `${inv.guestName}${inv.confirmationNo ? ` — ${inv.confirmationNo}` : ""}${!inv.isOpen ? " (Paid)" : ""}`,
    reference: inv.checkInDate && inv.checkOutDate
      ? `${format(parseISO(inv.checkInDate), "dd-MMM")} – ${format(parseISO(inv.checkOutDate), "dd-MMM-yy")}`
      : undefined,
    amount: inv.total,
  }))

  return (
    <PrintDocumentShell
      previewLabel={`Account Statement for ${accountName}`}
      fontClassName={fontClassName}
      extraActions={
        <div className="flex items-center gap-2">
          {sendResult && (
            <span className={`text-xs font-medium ${sendResult.isError ? "text-destructive" : "text-success"}`}>{sendResult.message}</span>
          )}
          <Button variant="outline" onClick={handleSendEmail} disabled={sending}>
            <Mail className="w-4 h-4 mr-2" /> {sending ? "Sending..." : "Email Statement"}
          </Button>
        </div>
      }
    >
      <PrintDocumentHeader
        brandName={settings?.invoiceBrandName || property.name}
        logoUrl={settings?.invoiceLogoUrl}
        address={settings?.invoiceAddress}
        phone={settings?.invoicePhone}
        email={settings?.invoiceEmail}
        taxId={settings?.invoiceTaxId}
        brandColor={brandColor}
        title="Account Statement"
        metaRows={[
          { label: "AR Number", value: profile.arNumber || "—" },
          { label: "Date", value: format(new Date(), "dd-MMM-yy") },
          { label: "Property", value: property.name },
        ]}
      />

      <PrintInfoColumns
        columns={[
          { heading: "Account", lines: [accountName, profile.profileType === "TRAVEL_AGENT" ? "Travel Agent" : "Company"] },
          { heading: "Open Balance Aging", lines: [
            `Current: ${aging.current.toFixed(2)}`,
            `1-30 days: ${aging["1-30"].toFixed(2)}`,
            `31-60 days: ${aging["31-60"].toFixed(2)}`,
            `61-90 days: ${aging["61-90"].toFixed(2)}`,
            `90+ days: ${aging["90+"].toFixed(2)}`,
          ] },
        ]}
      />

      <div className="mb-2">
        <h3 className="font-bold text-slate-500 uppercase tracking-wider text-[10px] mb-2">Invoices</h3>
        <PrintTransactionTable rows={invoiceRows} brandColor={brandColor} emptyLabel="No invoices billed to this account yet." />
      </div>

      <PrintTotals
        lines={[
          { label: "Total Invoiced", amount: totalInvoiced },
          { label: "Open Balance (Aging)", amount: totalOutstanding(aging) },
        ]}
        balanceLabel="Balance Due"
        balanceAmount={balance}
        brandColor={brandColor}
      />

      <PrintFooter
        paymentInfo={{
          accountName: settings?.invoicePaymentAccountName,
          accountNumber: settings?.invoicePaymentAccountNumber,
          iban: settings?.invoicePaymentIban,
          bankInfo: settings?.invoicePaymentBankInfo,
        }}
        terms={settings?.invoicePaymentTerms}
        closingText={settings?.invoiceFooterText}
      />
    </PrintDocumentShell>
  )
}
