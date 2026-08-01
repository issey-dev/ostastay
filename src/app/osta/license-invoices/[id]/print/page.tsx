"use client"

// Printable license tax invoice / payment receipt — Osta's own paper, branded from the
// /osta/controls settings (EnterpriseSettings invoiceBrand* + stationery content on
// Osta's row), NOT any property's stationery. The invoice uses the dedicated
// LicenseTaxInvoiceDocument (owner spec: single-page, "Tax Invoice" once, centre-split
// header, one description line, visible discount); a PAID invoice can flip to the
// payment-receipt view.

import { use, useEffect, useState } from "react"
import { PrintDocumentShell, PrintLoading, PrintError } from "@/components/print/print-document-shell"
import { LicenseTaxInvoiceDocument, LicenseReceiptDocument } from "@/components/print/stationery/license-invoice"
import type { StationeryBrand } from "@/lib/stationery-brand"
import { resolveStationeryFontClass } from "@/lib/stationery-fonts"
import { DEFAULT_INVOICE_BRAND_COLOR } from "@/lib/invoice-branding"
import { Button } from "@/components/ui/button"

type Payload = {
  invoice: {
    id: string
    invoiceNo: string
    periodStart: string
    periodEnd: string
    amount: number
    discountAmount: number
    currency: string
    status: string
    issuedAt: string
    dueAt: string | null
    paidAt: string | null
    paymentReference: string | null
    receiptNo: string | null
    notes: string | null
    enterprise: { name: string; slug: string }
  }
  ostaSettings: Record<string, string | number | boolean | null> | null
  properties: Array<{ name: string; code: string }>
  addons: string[]
}

const ADDON_LABELS: Record<string, string> = { SPA: "Spa", EXCURSIONS: "Excursions" }

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })

export default function LicenseInvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<"invoice" | "receipt">("invoice")

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await fetch(`/api/osta/license-invoices/${id}`)
      if (!res.ok) {
        if (!cancelled) setError("Could not load this invoice.")
        return
      }
      const payload: Payload = await res.json()
      if (!cancelled) {
        setData(payload)
        // ?doc=receipt opens straight in receipt mode (the Licensing screen's per-row
        // Receipt button). Read from location rather than useSearchParams so this
        // client page needs no Suspense boundary. A receipt only exists once PAID —
        // otherwise fall back to the invoice rather than render em-dashes.
        const wantsReceipt = new URLSearchParams(window.location.search).get("doc") === "receipt"
        if (wantsReceipt && payload.invoice.status === "PAID") setMode("receipt")
      }
    })()
    return () => { cancelled = true }
  }, [id])

  if (error) return <PrintError message={error} />
  if (!data) return <PrintLoading label="Preparing printable document..." />

  const { invoice } = data
  const s = data.ostaSettings ?? {}
  const str = (k: string) => (typeof s[k] === "string" && s[k] ? (s[k] as string) : null)

  const brand: StationeryBrand = {
    name: str("invoiceBrandName") ?? "OstaStay",
    logoUrl: str("invoiceLogoUrl"),
    address: str("invoiceAddress"),
    phone: str("invoicePhone"),
    email: str("invoiceEmail"),
    taxId: str("invoiceTaxId"),
    brandColor: str("invoiceBrandColor") ?? DEFAULT_INVOICE_BRAND_COLOR,
    fontClass: resolveStationeryFontClass(str("invoiceFontFamily")),
  }

  const period = `${fmt(invoice.periodStart)} → ${fmt(invoice.periodEnd)}`
  const addonNames = data.addons.map((a) => ADDON_LABELS[a] ?? a)
  const description =
    addonNames.length > 0
      ? `Platform License — ${addonNames.join(" & ")} add-on${addonNames.length > 1 ? "s" : ""} enabled`
      : "Platform License"

  return (
    <PrintDocumentShell
      previewLabel={mode === "invoice" ? `License Invoice ${invoice.invoiceNo}` : `Payment Receipt ${invoice.receiptNo ?? ""}`}
      fontClassName={brand.fontClass}
      extraActions={
        invoice.status === "PAID" ? (
          <Button variant="outline" onClick={() => setMode(mode === "invoice" ? "receipt" : "invoice")}>
            {mode === "invoice" ? "Show Payment Receipt" : "Show Invoice"}
          </Button>
        ) : undefined
      }
    >
      {mode === "invoice" ? (
        <LicenseTaxInvoiceDocument
          brand={brand}
          invoiceDate={fmt(invoice.issuedAt)}
          refNo={invoice.invoiceNo}
          servicePeriod={period}
          billTo={{
            enterpriseName: invoice.enterprise.name,
            enterpriseCode: invoice.enterprise.slug,
            properties: data.properties.map((p) => p.name),
          }}
          description={description}
          grossAmount={invoice.amount + invoice.discountAmount}
          discountAmount={invoice.discountAmount}
          netAmount={invoice.amount}
          currency={invoice.currency}
          paid={invoice.status === "PAID"}
          paymentInfo={{
            accountName: str("invoicePaymentAccountName"),
            accountNumber: str("invoicePaymentAccountNumber"),
            iban: str("invoicePaymentIban"),
            bankInfo: str("invoicePaymentBankInfo"),
          }}
          terms={str("invoicePaymentTerms")}
          footerNote={str("invoiceFooterText")}
        />
      ) : (
        <LicenseReceiptDocument
          brand={brand}
          receiptDate={invoice.paidAt ? fmt(invoice.paidAt) : "—"}
          receiptNo={invoice.receiptNo ?? "—"}
          invoiceRef={invoice.invoiceNo}
          servicePeriod={period}
          paymentReference={invoice.paymentReference}
          receivedFrom={{ enterpriseName: invoice.enterprise.name, enterpriseCode: invoice.enterprise.slug }}
          description={description}
          amount={invoice.amount}
          currency={invoice.currency}
          terms={str("receiptTerms")}
          footerNote={str("receiptFooterText")}
        />
      )}
    </PrintDocumentShell>
  )
}
