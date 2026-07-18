import { resolveInvoiceBrandColor, resolveBalanceColor } from "@/lib/invoice-branding"

// Presentational building blocks shared by Invoice, Payment Receipt, and Currency
// Exchange Receipt print pages — kept dumb (formatting only, no data fetching) so the
// same set can compose three different documents that still read as one family.

function formatMoney(amount: number) {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function PrintBigTitle({
  title,
  brandColor,
  disclaimer,
}: {
  title: string
  brandColor: string
  disclaimer?: string
}) {
  return (
    <div>
      <h1
        className="text-4xl font-black tracking-tight uppercase"
        style={{ color: resolveInvoiceBrandColor(brandColor) }}
      >
        {title}
      </h1>
      {disclaimer && (
        <p className="text-xs text-slate-500 mt-1 italic">{disclaimer}</p>
      )}
    </div>
  )
}

export function PrintDocumentHeader({
  brandName,
  logoUrl,
  address,
  phone,
  email,
  taxId,
  brandColor,
  title,
  disclaimer,
  metaRows,
}: {
  brandName: string
  logoUrl?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  taxId?: string | null
  brandColor: string
  title: string
  disclaimer?: string
  metaRows: Array<{ label: string; value: string }>
}) {
  const color = resolveInvoiceBrandColor(brandColor)
  return (
    <div className="mb-8 pb-6 border-b-2" style={{ borderColor: color }}>
      <div className="flex justify-between items-start gap-6">
        <div className="flex items-start gap-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={brandName} className="h-12 w-12 object-contain rounded" />
          ) : (
            <div
              className="h-12 w-12 rounded-full flex items-center justify-center text-white font-bold text-xl shrink-0"
              style={{ backgroundColor: color }}
            >
              {brandName?.[0]?.toUpperCase() || "?"}
            </div>
          )}
          <div className="text-sm">
            <div className="font-bold text-base text-slate-900">{brandName}</div>
            {address && <div className="text-slate-500 whitespace-pre-line">{address}</div>}
            {phone && <div className="text-slate-500">{phone}</div>}
            {email && <div className="text-slate-500">{email}</div>}
            {taxId && <div className="text-slate-500">Tax ID: {taxId}</div>}
          </div>
        </div>

        <div className="text-right shrink-0">
          <PrintBigTitle title={title} brandColor={brandColor} disclaimer={disclaimer} />
          <dl className="mt-3 text-xs space-y-0.5">
            {metaRows.map((row) => (
              <div key={row.label} className="flex justify-end gap-2">
                <dt className="text-slate-400">{row.label}</dt>
                <dd className="font-medium text-slate-700">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  )
}

export function PrintInfoColumns({ columns }: { columns: Array<{ heading: string; lines: string[] }> }) {
  return (
    <div className="grid grid-cols-3 gap-6 mb-8 text-sm">
      {columns.map((col) => (
        <div key={col.heading}>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">{col.heading}</div>
          {col.lines.filter(Boolean).map((line, i) => (
            <div key={i} className="text-slate-700 leading-relaxed">{line}</div>
          ))}
        </div>
      ))}
    </div>
  )
}

export type PrintTransactionRow = {
  date: string
  description: string
  reference?: string | null
  amount: number
}

export function PrintTransactionTable({
  rows,
  brandColor,
  emptyLabel = "No entries.",
}: {
  rows: PrintTransactionRow[]
  brandColor: string
  emptyLabel?: string
}) {
  const color = resolveInvoiceBrandColor(brandColor)
  return (
    <table className="w-full text-sm mb-6 border-collapse">
      <thead>
        <tr style={{ borderBottom: `2px solid ${color}` }}>
          <th className="text-left py-2 font-semibold text-slate-500 text-xs uppercase tracking-wide">Date</th>
          <th className="text-left py-2 font-semibold text-slate-500 text-xs uppercase tracking-wide">Description</th>
          <th className="text-left py-2 font-semibold text-slate-500 text-xs uppercase tracking-wide">Reference</th>
          <th className="text-right py-2 font-semibold text-slate-500 text-xs uppercase tracking-wide">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={4} className="py-4 text-center text-slate-400 text-xs">{emptyLabel}</td>
          </tr>
        ) : (
          rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-100">
              <td className="py-2 text-slate-600 whitespace-nowrap">{row.date}</td>
              <td className="py-2 text-slate-800">{row.description}</td>
              <td className="py-2 text-slate-500">{row.reference || "—"}</td>
              <td className="py-2 text-right font-medium text-slate-800 whitespace-nowrap">{formatMoney(row.amount)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}

export type PrintTotalLine = {
  label: string
  amount: number
  emphasis?: boolean
}

export function PrintTotals({
  lines,
  balanceLabel,
  balanceAmount,
  brandColor,
}: {
  lines: PrintTotalLine[]
  balanceLabel: string
  balanceAmount: number
  brandColor: string
}) {
  return (
    <div className="flex justify-end mb-8">
      <div className="w-full max-w-[280px] text-sm">
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
          className="flex justify-between py-2.5 mt-1 border-t-2 border-slate-800 font-bold text-base"
          style={{ color: resolveBalanceColor(balanceAmount, brandColor) }}
        >
          <span>{balanceLabel}</span>
          <span>{formatMoney(balanceAmount)}</span>
        </div>
      </div>
    </div>
  )
}

export function PrintFooter({
  paymentInfo,
  terms,
  closingText,
}: {
  paymentInfo?: {
    accountName?: string | null
    accountNumber?: string | null
    iban?: string | null
    bankInfo?: string | null
  }
  terms?: string | null
  closingText?: string | null
}) {
  const hasPaymentInfo = paymentInfo && (paymentInfo.accountName || paymentInfo.accountNumber || paymentInfo.iban || paymentInfo.bankInfo)

  return (
    <div className="pt-6 border-t border-slate-200">
      {(hasPaymentInfo || terms) && (
        <div className="grid grid-cols-2 gap-6 text-xs mb-6">
          {hasPaymentInfo && (
            <div>
              <div className="font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Payment Information</div>
              <div className="text-slate-600 space-y-0.5">
                {paymentInfo?.accountName && <div>Account Name: {paymentInfo.accountName}</div>}
                {paymentInfo?.accountNumber && <div>Account Number: {paymentInfo.accountNumber}</div>}
                {paymentInfo?.iban && <div>IBAN: {paymentInfo.iban}</div>}
                {paymentInfo?.bankInfo && <div className="whitespace-pre-line">{paymentInfo.bankInfo}</div>}
              </div>
            </div>
          )}
          {terms && (
            <div>
              <div className="font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Terms & Conditions</div>
              <div className="text-slate-600 whitespace-pre-line">{terms}</div>
            </div>
          )}
        </div>
      )}
      {closingText && (
        <div className="text-center text-sm text-slate-500 italic">{closingText}</div>
      )}
    </div>
  )
}
