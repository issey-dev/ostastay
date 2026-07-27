import type { StationeryBrand } from "@/lib/stationery-brand"
import { resolveBalanceColor } from "@/lib/invoice-branding"

// Presentational primitives for the redesigned stationery family, modelled on the owner's
// PDF template (Stationery redesign project). Every printed document — Invoice, Receipt,
// Confirmation Letter, Registration Card, Statement — and every live preview in the
// Stationaries configurator composes these same blocks, so the guest-facing output and the
// editor preview can never drift.
//
// Blocks are pure/dumb: formatting only, no data fetching. They render at real A4 scale
// (base text-sm); the configurator preview shrinks the whole document with a CSS transform
// rather than by re-styling, so what you see is exactly what prints.

export function formatMoney(amount: number) {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export type MetaItem = { label: string; value: string }
export type FieldItem = { label: string; value?: string | null }

export type StationeryRow = {
  date: string
  description: string
  reference?: string | null
  amount: number
}

export type StationeryTotalLine = {
  label: string
  amount: number
  emphasis?: boolean
}

// The logo mark: the property logo when set, otherwise a coloured initial tile. Outlet
// documents carry no logo (brand.logoUrl is nulled upstream), so they show the initial.
function BrandMark({ brand }: { brand: StationeryBrand }) {
  if (brand.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={brand.logoUrl} alt={brand.name} className="h-11 w-11 rounded-md object-contain" />
    )
  }
  return (
    <div
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-lg font-bold text-white"
      style={{ backgroundColor: brand.brandColor }}
    >
      {brand.name?.[0]?.toUpperCase() || "?"}
    </div>
  )
}

// The shared identity band + eyebrow + title at the top of every document. `meta` renders
// the stacked "Label value" lines shown under the title on financial/registration docs;
// omit it for the letter, which puts its own greeting there instead.
export function StationeryHeader({
  brand,
  eyebrow,
  title,
  meta,
}: {
  brand: StationeryBrand
  eyebrow: string
  title: string
  meta?: MetaItem[]
}) {
  return (
    <header className="mb-8">
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-start gap-3">
          <BrandMark brand={brand} />
          <div className="leading-tight">
            <div className="text-base font-bold tracking-tight text-slate-900">{brand.name}</div>
            {brand.address && <div className="mt-0.5 text-xs text-slate-500">{brand.address}</div>}
          </div>
        </div>
        <div className="space-y-0.5 text-right text-xs text-slate-500">
          {brand.phone && <div>{brand.phone}</div>}
          {brand.email && <div>{brand.email}</div>}
          {brand.taxId && <div>Tax ID: {brand.taxId}</div>}
        </div>
      </div>

      <div className="mt-5 border-t-2" style={{ borderColor: brand.brandColor }} />

      <div className="mt-4 flex items-end justify-between gap-6">
        <div>
          <div
            className="text-[11px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: brand.brandColor }}
          >
            {eyebrow}
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
        </div>
        {meta && meta.length > 0 && (
          <dl className="shrink-0 space-y-1 text-right text-xs">
            {meta.map((m) => (
              <div key={m.label} className="flex justify-end gap-2">
                <dt className="text-slate-400">{m.label}</dt>
                <dd className="font-medium text-slate-700">{m.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </header>
  )
}

// A titled section with the template's uppercase, letter-spaced heading.
export function StationerySection({
  title,
  children,
  className = "",
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`mb-6 ${className}`}>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{title}</h2>
      {children}
    </section>
  )
}

// Two-column "Label value" grid used by the Registration Card's detail blocks. An empty
// value renders a faint rule so the card can be completed by hand.
export function StationeryFieldGrid({ fields }: { fields: FieldItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-2.5 text-sm">
      {fields.map((f, i) => (
        <div key={i} className="flex items-baseline gap-2">
          <span className="w-28 shrink-0 text-slate-400">{f.label}</span>
          {f.value ? (
            <span className="font-medium text-slate-800">{f.value}</span>
          ) : (
            <span className="flex-1 border-b border-dashed border-slate-300">&nbsp;</span>
          )}
        </div>
      ))}
    </div>
  )
}

// Stacked "Label value" pairs (used for Payment Details / Received-from style blocks).
export function StationeryDefinitionList({ items }: { items: MetaItem[] }) {
  return (
    <dl className="space-y-1 text-sm">
      {items.map((it) => (
        <div key={it.label} className="flex gap-2">
          <dt className="w-28 shrink-0 text-slate-400">{it.label}</dt>
          <dd className="font-medium text-slate-800">{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// The charges / payments transaction table.
export function StationeryTable({
  rows,
  brandColor,
  emptyLabel = "No entries.",
}: {
  rows: StationeryRow[]
  brandColor: string
  emptyLabel?: string
}) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr style={{ borderBottom: `1.5px solid ${brandColor}` }}>
          <th className="py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Date</th>
          <th className="py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Description</th>
          <th className="py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Reference</th>
          <th className="py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={4} className="py-3 text-center text-xs text-slate-400">
              {emptyLabel}
            </td>
          </tr>
        ) : (
          rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-100">
              <td className="whitespace-nowrap py-1.5 text-slate-600">{row.date}</td>
              <td className="py-1.5 text-slate-800">{row.description}</td>
              <td className="py-1.5 text-slate-500">{row.reference || "—"}</td>
              <td className="whitespace-nowrap py-1.5 text-right font-medium text-slate-800">{formatMoney(row.amount)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}

// Right-aligned totals with an emphasised final balance row (currency-prefixed like the
// template's "NET BALANCE DUE USD 645.00").
export function StationeryTotals({
  lines,
  balanceLabel,
  balanceAmount,
  currency,
  brandColor,
}: {
  lines: StationeryTotalLine[]
  balanceLabel: string
  balanceAmount: number
  currency: string
  brandColor: string
}) {
  return (
    <div className="mb-8 flex justify-end">
      <div className="w-full max-w-[300px] text-sm">
        {lines.map((line) => (
          <div
            key={line.label}
            className={`flex justify-between py-1.5 ${line.emphasis ? "font-semibold text-slate-800" : "text-slate-500"}`}
          >
            <span>{line.label}</span>
            <span>{formatMoney(line.amount)}</span>
          </div>
        ))}
        <div
          className="mt-1 flex justify-between border-t-2 border-slate-800 py-2.5 text-base font-bold"
          style={{ color: resolveBalanceColor(balanceAmount, brandColor) }}
        >
          <span>{balanceLabel}</span>
          <span>
            {currency} {formatMoney(balanceAmount)}
          </span>
        </div>
      </div>
    </div>
  )
}

// A single prominent amount line (Receipt's "AMOUNT RECEIVED USD 500.00").
export function StationeryAmountCallout({
  label,
  amount,
  currency,
  brandColor,
}: {
  label: string
  amount: number
  currency: string
  brandColor: string
}) {
  return (
    <div
      className="mb-6 flex items-center justify-between rounded-md px-4 py-3 text-base font-bold text-white"
      style={{ backgroundColor: brandColor }}
    >
      <span className="uppercase tracking-wide">{label}</span>
      <span>
        {currency} {formatMoney(amount)}
      </span>
    </div>
  )
}

// The shared footer: an optional payment-info + terms row, then a centred closing note and
// contact line. `paymentInfo` is only used by invoices.
export function StationeryFooter({
  paymentInfo,
  terms,
  note,
  contactLine,
}: {
  paymentInfo?: {
    accountName?: string | null
    accountNumber?: string | null
    iban?: string | null
    bankInfo?: string | null
  } | null
  terms?: string | null
  note?: string | null
  contactLine?: string | null
}) {
  const hasPaymentInfo =
    paymentInfo &&
    (paymentInfo.accountName || paymentInfo.accountNumber || paymentInfo.iban || paymentInfo.bankInfo)

  return (
    <footer className="mt-auto border-t border-slate-200 pt-5">
      {(hasPaymentInfo || terms) && (
        <div className="mb-5 grid grid-cols-2 gap-6 text-xs">
          {hasPaymentInfo && (
            <div>
              <div className="mb-1.5 font-semibold uppercase tracking-wide text-slate-500">Payment Information</div>
              <div className="space-y-0.5 text-slate-600">
                {paymentInfo?.accountName && <div>Account Name: {paymentInfo.accountName}</div>}
                {paymentInfo?.accountNumber && <div>Account Number: {paymentInfo.accountNumber}</div>}
                {paymentInfo?.iban && <div>IBAN: {paymentInfo.iban}</div>}
                {paymentInfo?.bankInfo && <div className="whitespace-pre-line">{paymentInfo.bankInfo}</div>}
              </div>
            </div>
          )}
          {terms && (
            <div className={hasPaymentInfo ? "" : "col-span-2"}>
              <div className="mb-1.5 font-semibold uppercase tracking-wide text-slate-500">Terms &amp; Conditions</div>
              <div className="whitespace-pre-line text-slate-600">{terms}</div>
            </div>
          )}
        </div>
      )}
      {note && <p className="text-center text-sm italic text-slate-500 whitespace-pre-line">{note}</p>}
      {contactLine && <p className="mt-2 text-center text-[11px] text-slate-400">{contactLine}</p>}
    </footer>
  )
}

// The A4 content frame every document renders inside — sets the font class and a min-height
// so the footer sits at the bottom (flex column). The print page wraps this in
// PrintDocumentShell; the configurator wraps it in the scaled preview frame.
export function StationeryPage({
  fontClass,
  children,
}: {
  fontClass: string
  children: React.ReactNode
}) {
  return (
    <div className={`flex min-h-[1000px] flex-col text-slate-800 ${fontClass}`}>{children}</div>
  )
}
