import type { StationeryBrand } from "@/lib/stationery-brand"
import {
  StationeryPage,
  StationeryHeader,
  StationerySection,
  StationeryFieldGrid,
  StationeryDefinitionList,
  StationeryTable,
  StationeryTotals,
  StationeryAmountCallout,
  StationeryFooter,
  type MetaItem,
  type FieldItem,
  type StationeryRow,
  type StationeryTotalLine,
} from "./blocks"

// Full document layouts, one per stationary type, composed from ./blocks and modelled on
// the owner's PDF template. Each takes fully-resolved props (brand + content + data) so the
// same component renders the real printed page (fed live data) and the configurator preview
// (fed sample data) — no drift between what's configured and what's printed.

// ---------------------------------------------------------------- Invoice ----

export type InvoiceVariant = "proforma" | "tax" | "interim"

const INVOICE_LABELS: Record<InvoiceVariant, { eyebrow: string; title: string }> = {
  proforma: { eyebrow: "Proforma · This is not a tax invoice", title: "Proforma invoice" },
  tax: { eyebrow: "Tax invoice", title: "Tax invoice" },
  interim: { eyebrow: "Interim · Not a tax invoice", title: "Interim bill" },
}

export type InvoiceDocumentProps = {
  brand: StationeryBrand
  variant: InvoiceVariant
  meta: MetaItem[]
  headerText?: string | null
  billedTo: { name: string; lines: string[] }
  staySummary?: MetaItem[] | null
  staySummaryHeading?: string
  roomAssignments?: { room: string; type: string; dates: string }[]
  charges: StationeryRow[]
  payments: StationeryRow[]
  totals: StationeryTotalLine[]
  balanceLabel: string
  balanceAmount: number
  currency: string
  paymentInfo?: {
    accountName?: string | null
    accountNumber?: string | null
    iban?: string | null
    bankInfo?: string | null
  } | null
  terms?: string | null
  footerNote?: string | null
}

// Interleave payments into the charge list by real date. Rows carrying a sortKey sort on
// it; where any row lacks one (the Controls sample data) the original charges-then-
// payments order is kept rather than sorting formatted date strings, which would order
// "01-Aug" before "02-Jul".
function mergeLedger(charges: StationeryRow[], payments: StationeryRow[]): StationeryRow[] {
  const all = [...charges, ...payments]
  if (all.some((r) => !r.sortKey)) return all
  return all
    .map((row, i) => ({ row, i }))
    .sort((a, b) => (a.row.sortKey! < b.row.sortKey! ? -1 : a.row.sortKey! > b.row.sortKey! ? 1 : a.i - b.i))
    .map(({ row }) => row)
}

export function InvoiceDocument({
  brand,
  variant,
  meta,
  headerText,
  billedTo,
  staySummary,
  staySummaryHeading = "Stay Summary",
  roomAssignments,
  charges,
  payments,
  totals,
  balanceLabel,
  balanceAmount,
  currency,
  paymentInfo,
  terms,
  footerNote,
}: InvoiceDocumentProps) {
  const labels = INVOICE_LABELS[variant]
  return (
    <StationeryPage fontClass={brand.fontClass}>
      <StationeryHeader brand={brand} eyebrow={labels.eyebrow} title={labels.title} meta={meta} />

      {headerText && (
        <div className="mb-6 whitespace-pre-line rounded-md border border-slate-100 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
          {headerText}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-8">
        <StationerySection title="Billed To" className="mb-0">
          <div className="text-sm font-semibold text-slate-800">{billedTo.name}</div>
          {billedTo.lines.filter(Boolean).map((line, i) => (
            <div key={i} className="text-sm text-slate-500">
              {line}
            </div>
          ))}
        </StationerySection>
        {staySummary && staySummary.length > 0 && (
          <StationerySection title={staySummaryHeading} className="mb-0">
            <StationeryDefinitionList items={staySummary} />
          </StationerySection>
        )}
      </div>

      {roomAssignments && roomAssignments.length > 0 && (
        <StationerySection title="Room Assignments">
          <div className="overflow-hidden rounded-md border border-slate-200">
            <table className="w-full text-xs text-slate-700">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="p-2 text-left font-semibold">Room</th>
                  <th className="p-2 text-left font-semibold">Room Type</th>
                  <th className="p-2 text-right font-semibold">Dates</th>
                </tr>
              </thead>
              <tbody>
                {roomAssignments.map((a, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    <td className="p-2 font-semibold">{a.room}</td>
                    <td className="p-2">{a.type}</td>
                    <td className="p-2 text-right text-slate-500">{a.dates}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StationerySection>
      )}

      {/* Charges and payments read as ONE chronological ledger (owner rule,
          2026-08-03): a payment is an entry against the stay like any other, shown as a
          negative figure on the day it happened, not exiled to a second table the guest
          has to cross-reference. Merged here rather than by each caller so the Controls
          preview and the real document cannot drift apart. */}
      <StationerySection title="Charges & Payments">
        <StationeryTable
          rows={mergeLedger(charges, payments)}
          brandColor={brand.brandColor}
          emptyLabel="Nothing posted."
        />
      </StationerySection>

      <StationeryTotals
        lines={totals}
        balanceLabel={balanceLabel}
        balanceAmount={balanceAmount}
        currency={currency}
        brandColor={brand.brandColor}
      />

      <StationeryFooter paymentInfo={paymentInfo} terms={terms} note={footerNote} />
    </StationeryPage>
  )
}

// ---------------------------------------------------------------- Receipt ----

export type ReceiptKind = "payment" | "exchange"

const RECEIPT_EYEBROW: Record<ReceiptKind, string> = {
  payment: "Payment",
  exchange: "Currency exchange",
}

export type ReceiptDocumentProps = {
  brand: StationeryBrand
  kind: ReceiptKind
  meta: MetaItem[]
  receivedFrom: string
  paymentDetails: MetaItem[]
  rows: StationeryRow[]
  amountLabel: string
  amount: number
  currency: string
  remainingLabel?: string | null
  remainingAmount?: number | null
  terms?: string | null
  footerNote?: string | null
}

export function ReceiptDocument({
  brand,
  kind,
  meta,
  receivedFrom,
  paymentDetails,
  rows,
  amountLabel,
  amount,
  currency,
  remainingLabel,
  remainingAmount,
  terms,
  footerNote,
}: ReceiptDocumentProps) {
  return (
    <StationeryPage fontClass={brand.fontClass}>
      <StationeryHeader brand={brand} eyebrow={RECEIPT_EYEBROW[kind]} title="Receipt" meta={meta} />

      <div className="mb-6 grid grid-cols-2 gap-8">
        <StationerySection title="Received From" className="mb-0">
          <div className="text-sm font-semibold text-slate-800">{receivedFrom}</div>
        </StationerySection>
        {paymentDetails.length > 0 && (
          <StationerySection title="Payment Details" className="mb-0">
            <StationeryDefinitionList items={paymentDetails} />
          </StationerySection>
        )}
      </div>

      <StationerySection title="Details">
        <StationeryTable rows={rows} brandColor={brand.brandColor} emptyLabel="No entries." />
      </StationerySection>

      <StationeryAmountCallout label={amountLabel} amount={amount} currency={currency} brandColor={brand.brandColor} />

      {remainingLabel != null && remainingAmount != null && (
        <div className="mb-8 flex justify-end text-sm text-slate-500">
          <span className="mr-2">{remainingLabel}</span>
          <span className="font-medium text-slate-700">
            {currency} {remainingAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}

      <StationeryFooter terms={terms} note={footerNote} />
    </StationeryPage>
  )
}

// ------------------------------------------------------ Confirmation Letter ----

export type ConfirmationLetterDocumentProps = {
  brand: StationeryBrand
  guestName: string
  date: string
  intro?: string
  details: MetaItem[]
  policyText: string
  closingTeam: string
  footerContactLine?: string | null
}

export function ConfirmationLetterDocument({
  brand,
  guestName,
  date,
  intro,
  details,
  policyText,
  closingTeam,
  footerContactLine,
}: ConfirmationLetterDocumentProps) {
  return (
    <StationeryPage fontClass={brand.fontClass}>
      <StationeryHeader brand={brand} eyebrow="Reservation" title="Confirmation of stay" />

      <div className="mb-4 flex items-baseline justify-between gap-4">
        <div className="text-sm">
          <span className="text-slate-500">Dear </span>
          <span className="font-semibold text-slate-800">{guestName}</span>,
        </div>
        <div className="text-sm text-slate-500">{date}</div>
      </div>

      <p className="mb-5 text-sm leading-relaxed text-slate-600">
        {intro ||
          `We are delighted to confirm your upcoming reservation with ${brand.name}. Please find the details of your stay below — this letter may be presented as confirmation of accommodation where required.`}
      </p>

      <div className="mb-5 rounded-md border border-slate-200 bg-slate-50 p-4">
        <dl className="space-y-2 text-sm">
          {details.map((d) => (
            <div key={d.label} className="flex justify-between gap-4">
              <dt className="uppercase tracking-wide text-[11px] font-semibold text-slate-400 self-center">{d.label}</dt>
              <dd className="text-right font-medium text-slate-800">{d.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="mb-6 whitespace-pre-line text-sm leading-relaxed text-slate-600">{policyText}</p>

      <div className="mb-8 text-sm text-slate-600">
        <p>We look forward to welcoming you.</p>
        <p className="mt-3">Warm regards,</p>
        <p className="font-semibold text-slate-800">{closingTeam}</p>
      </div>

      <StationeryFooter contactLine={footerContactLine} />
    </StationeryPage>
  )
}

// ------------------------------------------------------- Registration Card ----

export type RegistrationCardDocumentProps = {
  brand: StationeryBrand
  meta: MetaItem[]
  welcomeMessage: string
  guestDetails: FieldItem[]
  stayDetails: FieldItem[]
  identification: FieldItem[]
  terms: string
  // Present when the guest already signed electronically via eRegistration — renders the
  // captured signature in place of a blank line, so front office isn't asking someone to
  // sign twice.
  guestSignature?: { dataUrl: string; capturedLabel: string } | null
}

function SignatureLine({ label, signature }: { label: string; signature?: { dataUrl: string; capturedLabel: string } | null }) {
  return (
    <div>
      <div className="mb-1.5 flex h-12 items-end justify-center border-b border-slate-400">
        {signature && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={signature.dataUrl} alt={`${label} (electronic)`} className="max-h-11 object-contain" />
        )}
      </div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      {signature && (
        <div className="text-[8px] font-medium text-yellow-600">e-signature — captured {signature.capturedLabel}</div>
      )}
    </div>
  )
}

export function RegistrationCardDocument({
  brand,
  meta,
  welcomeMessage,
  guestDetails,
  stayDetails,
  identification,
  terms,
  guestSignature,
}: RegistrationCardDocumentProps) {
  return (
    <StationeryPage fontClass={brand.fontClass}>
      <StationeryHeader brand={brand} eyebrow="Front office" title="Registration card" meta={meta} />

      {welcomeMessage && <p className="mb-6 text-sm text-slate-600">{welcomeMessage}</p>}

      <StationerySection title="Guest Details">
        <StationeryFieldGrid fields={guestDetails} />
      </StationerySection>

      <StationerySection title="Stay Details">
        <StationeryFieldGrid fields={stayDetails} />
      </StationerySection>

      <StationerySection title="Identification">
        <StationeryFieldGrid fields={identification} />
      </StationerySection>

      <StationerySection title="Terms & Conditions">
        <p className="whitespace-pre-line text-xs leading-relaxed text-slate-500">{terms}</p>
      </StationerySection>

      <div className="mt-auto grid grid-cols-2 gap-10 pt-8">
        <SignatureLine label="Guest Signature" signature={guestSignature} />
        <SignatureLine label="Front Office" />
      </div>
    </StationeryPage>
  )
}

// -------------------------------------------------------------- Statement ----
// Scaffold layout pending the owner's dedicated Account Statement template.

export type StatementDocumentProps = {
  brand: StationeryBrand
  meta: MetaItem[]
  account: { name: string; lines: string[] }
  aging?: MetaItem[]
  rows: StationeryRow[]
  totals: StationeryTotalLine[]
  balanceLabel: string
  balanceAmount: number
  currency: string
  terms?: string | null
  footerNote?: string | null
}

export function StatementDocument({
  brand,
  meta,
  account,
  aging,
  rows,
  totals,
  balanceLabel,
  balanceAmount,
  currency,
  terms,
  footerNote,
}: StatementDocumentProps) {
  return (
    <StationeryPage fontClass={brand.fontClass}>
      <StationeryHeader brand={brand} eyebrow="Account" title="Account statement" meta={meta} />

      <StationerySection title="Account">
        <div className="text-sm font-semibold text-slate-800">{account.name}</div>
        {account.lines.filter(Boolean).map((line, i) => (
          <div key={i} className="text-sm text-slate-500">
            {line}
          </div>
        ))}
      </StationerySection>

      {aging && aging.length > 0 && (
        <StationerySection title="Open Balance Aging">
          <div className="grid grid-cols-5 gap-2 text-center">
            {aging.map((a) => (
              <div key={a.label} className="rounded-md bg-slate-50 p-2">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">{a.label}</div>
                <div className="mt-0.5 text-sm font-semibold text-slate-800">{a.value}</div>
              </div>
            ))}
          </div>
        </StationerySection>
      )}

      <StationerySection title="Invoices">
        <StationeryTable rows={rows} brandColor={brand.brandColor} emptyLabel="No invoices." />
      </StationerySection>

      <StationeryTotals
        lines={totals}
        balanceLabel={balanceLabel}
        balanceAmount={balanceAmount}
        currency={currency}
        brandColor={brand.brandColor}
      />

      <StationeryFooter terms={terms} note={footerNote} />
    </StationeryPage>
  )
}
