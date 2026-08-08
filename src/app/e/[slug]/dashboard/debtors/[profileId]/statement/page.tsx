"use client"

import { useEffect, useState, use } from "react"
import { format, parseISO } from "date-fns"
import { Mail } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { totalOutstanding } from "@/lib/debtor-aging"
import { resolveStationeryBrand } from "@/lib/stationery-brand"
import { PrintDocumentShell, PrintLoading, PrintError } from "@/components/print/print-document-shell"
import { EmailDocumentDialog } from "@/components/print/email-document-dialog"
import { StatementDocument } from "@/components/print/stationery/documents"
import type { StationeryRow, MetaItem } from "@/components/print/stationery/blocks"

export default function DebtorStatementPage({ params }: { params: Promise<{ profileId: string; slug: string }> }) {
  const { profileId, slug } = use(params)

  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [emailOpen, setEmailOpen] = useState(false)

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

  const handleSendEmail = async (email: string) => {
    const sess = await fetch("/api/session/current-property").then((r) => r.json())
    const res = await fetch(`/api/debtors/accounts/${profileId}/send-statement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId: sess?.currentPropertyId, email, slug }),
    })
    const body = await res.json()
    return res.ok ? { ok: true as const } : { ok: false as const, error: body.error || "Failed to send." }
  }

  const handleDownloadPdf = async () => {
    const sess = await fetch("/api/session/current-property").then((r) => r.json())
    const propertyId = sess?.currentPropertyId
    if (!propertyId) return
    window.open(`/api/debtors/accounts/${profileId}/send-statement?propertyId=${propertyId}`, "_blank")
  }

  if (loading) return <PrintLoading label="Preparing statement..." />
  if (error || !data) return <PrintError message={error || "Account not found"} />

  const { profile, property, invoices, balance, aging, settings } = data
  const accountName = profile.companyName || `${profile.firstName} ${profile.lastName || ""}`.trim()

  const brand = resolveStationeryBrand(property)
  const currency = property.defaultCurrency || "USD"

  const totalInvoiced = invoices.reduce((sum: number, inv: any) => sum + inv.total, 0)

  const invoiceRows: StationeryRow[] = invoices.map((inv: any) => ({
    date: inv.checkOutDate ? format(parseISO(inv.checkOutDate), "dd-MMM-yy") : "—",
    description: `${inv.guestName}${inv.confirmationNo ? ` — ${inv.confirmationNo}` : ""}${!inv.isOpen ? " (Paid)" : ""}`,
    reference: inv.checkInDate && inv.checkOutDate
      ? `${format(parseISO(inv.checkInDate), "dd-MMM")} – ${format(parseISO(inv.checkOutDate), "dd-MMM-yy")}`
      : undefined,
    amount: inv.total,
  }))

  const meta: MetaItem[] = [
    { label: "AR Number", value: profile.arNumber || "—" },
    { label: "Date", value: format(new Date(), "dd-MMM-yy") },
    { label: "Property", value: property.name },
  ]

  const agingRow: MetaItem[] = [
    { label: "Current", value: aging.current.toFixed(2) },
    { label: "1–30d", value: aging["1-30"].toFixed(2) },
    { label: "31–60d", value: aging["31-60"].toFixed(2) },
    { label: "61–90d", value: aging["61-90"].toFixed(2) },
    { label: "90+d", value: aging["90+"].toFixed(2) },
  ]

  return (
    <PrintDocumentShell
      previewLabel={`Account Statement for ${accountName}`}
      fontClassName={brand.fontClass}
      printLabel="Download PDF"
      onPrint={handleDownloadPdf}
      extraActions={
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setEmailOpen(true)}>
            <Mail className="w-4 h-4 mr-2" /> Email
          </Button>
          <EmailDocumentDialog
            open={emailOpen}
            onOpenChange={setEmailOpen}
            profileUpid={profileId}
            documentLabel="Account Statement"
            onSend={handleSendEmail}
          />
        </div>
      }
    >
      <StatementDocument
        brand={brand}
        meta={meta}
        account={{ name: accountName, lines: [profile.profileType === "TRAVEL_AGENT" ? "Travel Agent" : "Company"] }}
        aging={agingRow}
        rows={invoiceRows}
        totals={[
          { label: "Total Invoiced", amount: totalInvoiced },
          { label: "Open Balance (Aging)", amount: totalOutstanding(aging) },
        ]}
        balanceLabel="Balance Due"
        balanceAmount={balance}
        currency={currency}
        terms={settings?.statementTerms}
        footerNote={settings?.statementFooterText}
      />
    </PrintDocumentShell>
  )
}
