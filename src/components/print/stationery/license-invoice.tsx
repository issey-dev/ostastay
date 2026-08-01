import type { StationeryBrand } from "@/lib/stationery-brand"
import {
  StationeryPage,
  StationerySection,
  StationeryFooter,
  StationeryAmountCallout,
  formatMoney,
  type MetaItem,
} from "./blocks"

// Osta's LICENSE tax invoice — the platform's own paper, sent to client enterprises.
// Deliberately NOT the guest-folio InvoiceDocument: the owner's spec (2026-07-31) is a
// single-page document with "Tax Invoice" shown exactly once, a centre-split header
// (left: invoice date / service / ref / service period · right: Bill To with enterprise
// and property details), ONE description line (platform license, plus enabled add-ons
// mentioned in the same line), and a visible goodwill discount. No stay summary, no
// payments table, no per-line dates — those are folio concepts.

export type LicenseTaxInvoiceProps = {
  brand: StationeryBrand
  invoiceDate: string
  refNo: string
  servicePeriod: string
  billTo: {
    enterpriseName: string
    enterpriseCode: string
    properties: string[]
  }
  // e.g. "Platform License" or "Platform License — Spa & Excursions add-ons enabled"
  description: string
  grossAmount: number
  discountAmount: number
  netAmount: number
  currency: string
  paid: boolean
  paymentInfo?: {
    accountName?: string | null
    accountNumber?: string | null
    iban?: string | null
    bankInfo?: string | null
  } | null
  terms?: string | null
  footerNote?: string | null
}

function BrandRow({ brand }: { brand: StationeryBrand }) {
  return (
    <div>
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-start gap-3">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt="" className="h-10 w-10 object-contain" />
          ) : (
            <div
              className="flex h-10 w-10 items-center justify-center text-sm font-bold text-white"
              style={{ backgroundColor: brand.brandColor }}
            >
              {brand.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="leading-tight">
            <div className="text-base font-bold tracking-tight text-slate-900">{brand.name}</div>
            {brand.address && <div className="mt-0.5 text-xs text-slate-500 whitespace-pre-line">{brand.address}</div>}
          </div>
        </div>
        <div className="space-y-0.5 text-right text-xs text-slate-500">
          {brand.phone && <div>{brand.phone}</div>}
          {brand.email && <div>{brand.email}</div>}
          {brand.taxId && <div>Tax ID: {brand.taxId}</div>}
        </div>
      </div>
      <div className="mt-4 border-t-2" style={{ borderColor: brand.brandColor }} />
    </div>
  )
}

export function LicenseTaxInvoiceDocument({
  brand,
  invoiceDate,
  refNo,
  servicePeriod,
  billTo,
  description,
  grossAmount,
  discountAmount,
  netAmount,
  currency,
  paid,
  paymentInfo,
  terms,
  footerNote,
}: LicenseTaxInvoiceProps) {
  const detailItems: MetaItem[] = [
    { label: "Invoice Date", value: invoiceDate },
    { label: "Service", value: "Platform License" },
    { label: "Ref", value: refNo },
    { label: "Service Period", value: servicePeriod },
  ]

  return (
    <StationeryPage fontClass={brand.fontClass}>
      <BrandRow brand={brand} />

      {/* The title, exactly once. */}
      <h1 className="mt-5 mb-6 text-3xl font-bold tracking-tight text-slate-900">Tax Invoice</h1>

      {/* Centre-split header: invoice facts left, Bill To right. */}
      <div className="mb-8 grid grid-cols-2 gap-8">
        <dl className="space-y-1.5 text-sm">
          {detailItems.map((m) => (
            <div key={m.label} className="flex gap-2">
              <dt className="w-32 shrink-0 text-slate-400">{m.label}</dt>
              <dd className="font-medium text-slate-700">{m.value}</dd>
            </div>
          ))}
        </dl>
        <div className="text-sm">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Bill To</div>
          <div className="font-semibold text-slate-900">{billTo.enterpriseName}</div>
          <div className="text-xs text-slate-500">Enterprise code: {billTo.enterpriseCode}</div>
          {billTo.properties.length > 0 && (
            <div className="mt-1.5 space-y-0.5 text-xs text-slate-600">
              {billTo.properties.map((p) => (
                <div key={p}>{p}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Details: always exactly one line. */}
      <StationerySection title="Details">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-slate-800 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-4">Description</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-200">
              <td className="py-3 pr-4 text-slate-700">{description}</td>
              <td className="py-3 text-right font-medium tabular-nums text-slate-800">{formatMoney(grossAmount)}</td>
            </tr>
          </tbody>
        </table>
      </StationerySection>

      <div className="mb-8 flex justify-end">
        <div className="w-full max-w-[300px] text-sm">
          <div className="flex justify-between py-1.5 text-slate-500">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatMoney(grossAmount)}</span>
          </div>
          {discountAmount > 0 && (
            <div className="flex justify-between py-1.5 font-medium" style={{ color: brand.brandColor }}>
              <span>Discount</span>
              <span className="tabular-nums">− {formatMoney(discountAmount)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t-2 border-slate-800 py-2.5 text-base font-bold text-slate-900">
            <span>{paid ? "Total · PAID" : "Total Due"}</span>
            <span className="tabular-nums">
              {currency} {formatMoney(netAmount)}
            </span>
          </div>
        </div>
      </div>

      <StationeryFooter paymentInfo={paid ? null : paymentInfo} terms={terms} note={footerNote} />
    </StationeryPage>
  )
}

// The matching payment receipt — same paper, same centre-split header, deliberately
// simpler: no line table, no totals stack, just the facts and one prominent amount.
export type LicenseReceiptProps = {
  brand: StationeryBrand
  receiptDate: string
  receiptNo: string
  invoiceRef: string
  servicePeriod: string
  paymentReference?: string | null
  receivedFrom: {
    enterpriseName: string
    enterpriseCode: string
  }
  description: string
  amount: number
  currency: string
  terms?: string | null
  footerNote?: string | null
}

export function LicenseReceiptDocument({
  brand,
  receiptDate,
  receiptNo,
  invoiceRef,
  servicePeriod,
  paymentReference,
  receivedFrom,
  description,
  amount,
  currency,
  terms,
  footerNote,
}: LicenseReceiptProps) {
  const detailItems: MetaItem[] = [
    { label: "Receipt Date", value: receiptDate },
    { label: "Receipt No", value: receiptNo },
    { label: "Invoice Ref", value: invoiceRef },
    { label: "Service Period", value: servicePeriod },
    ...(paymentReference ? [{ label: "Payment Ref", value: paymentReference }] : []),
  ]

  return (
    <StationeryPage fontClass={brand.fontClass}>
      <BrandRow brand={brand} />

      <h1 className="mt-5 mb-6 text-3xl font-bold tracking-tight text-slate-900">Payment Receipt</h1>

      <div className="mb-8 grid grid-cols-2 gap-8">
        <dl className="space-y-1.5 text-sm">
          {detailItems.map((m) => (
            <div key={m.label} className="flex gap-2">
              <dt className="w-32 shrink-0 text-slate-400">{m.label}</dt>
              <dd className="font-medium text-slate-700">{m.value}</dd>
            </div>
          ))}
        </dl>
        <div className="text-sm">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Received From</div>
          <div className="font-semibold text-slate-900">{receivedFrom.enterpriseName}</div>
          <div className="text-xs text-slate-500">Enterprise code: {receivedFrom.enterpriseCode}</div>
        </div>
      </div>

      <StationerySection title="Payment For">
        <p className="text-sm text-slate-700">{description}</p>
      </StationerySection>

      <StationeryAmountCallout label="Amount Received" amount={amount} currency={currency} brandColor={brand.brandColor} />

      <StationeryFooter terms={terms} note={footerNote} />
    </StationeryPage>
  )
}

export function buildSampleLicenseReceipt(
  brand: StationeryBrand,
  content: { receiptFooterText: string; receiptTerms: string }
): LicenseReceiptProps {
  return {
    brand,
    receiptDate: "05 Aug 2026",
    receiptNo: "RCP-2026-0001",
    invoiceRef: "LIC-2026-0001",
    servicePeriod: "01 Aug 2026 → 31 Aug 2026",
    paymentReference: "BML-4451923",
    receivedFrom: { enterpriseName: "Veyo Hospitality", enterpriseCode: "veyo" },
    description: "Platform License — Spa & Excursions add-ons enabled",
    amount: 199.0,
    currency: "USD",
    terms: content.receiptTerms || null,
    footerNote: content.receiptFooterText || null,
  }
}

// Sample for the /osta/controls live preview — mirrors what the print page assembles
// from a real LicenseInvoice row.
export function buildSampleLicenseInvoice(
  brand: StationeryBrand,
  content: { invoicePaymentAccountName: string; invoicePaymentAccountNumber: string; invoicePaymentIban: string; invoicePaymentBankInfo: string; invoicePaymentTerms: string; invoiceFooterText: string }
): LicenseTaxInvoiceProps {
  return {
    brand,
    invoiceDate: "31 Jul 2026",
    refNo: "LIC-2026-0001",
    servicePeriod: "01 Aug 2026 → 31 Aug 2026",
    billTo: {
      enterpriseName: "Veyo Hospitality",
      enterpriseCode: "veyo",
      properties: ["Veyo Beach Resort", "Veyo Lagoon Retreat"],
    },
    description: "Platform License — Spa & Excursions add-ons enabled",
    grossAmount: 249.0,
    discountAmount: 50.0,
    netAmount: 199.0,
    currency: "USD",
    paid: false,
    paymentInfo: {
      accountName: content.invoicePaymentAccountName || null,
      accountNumber: content.invoicePaymentAccountNumber || null,
      iban: content.invoicePaymentIban || null,
      bankInfo: content.invoicePaymentBankInfo || null,
    },
    terms: content.invoicePaymentTerms || null,
    footerNote: content.invoiceFooterText || null,
  }
}
