"use client"

import { StationeryHeader } from "@/components/print/stationery/blocks"
import { resolveStationeryBrand, type StationeryBrand } from "@/lib/stationery-brand"
import { useProperty } from "@/components/providers/property-provider"

// The printed shift report, shown ONLY when printing (the on-screen result card is hidden
// then). Fixed print colours (--print-*), not the app theme's, so it prints dark-on-white
// whatever theme the cashier is using; no buttons, no page chrome, nothing from the shift
// history list.

const money = (n: number) => `$${n.toFixed(2)}`
const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"

export type ShiftReport = {
  propertyName?: string | null
  brand?: StationeryBrand | null
  cashierName?: string | null
  shift?: { id: string } | null
  openedAt?: string | null
  closedAt?: string | null
  openingFloat?: number
  expectedCash: number
  actualDrop: number
  discrepancy: number
  byMethod?: { method: string; received: number; refunded: number; net: number }[]
  cashDrawer?: { openingFloat: number; cashIn: number; cashOut: number; paidOuts: number; exchangeNet: number; expected: number }
  paidOuts?: { reason: string; amount: number; guest?: string | null; room?: string | null; at: string }[]
  exchanges?: { text: string; guest?: string | null; room?: string | null; at: string }[]
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 break-inside-avoid">
      <h2 className="mb-1.5 border-b border-[var(--print-ink)] pb-1 text-[11px] font-bold uppercase tracking-wider text-[var(--print-ink)]">{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, value, strong, note }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean; note?: React.ReactNode }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1 text-sm ${strong ? "border-t border-[var(--print-ink)] pt-1.5 font-bold" : ""}`}>
      <span className="min-w-0 text-[var(--print-ink)]">
        {label}
        {note && <span className="block text-xs font-normal text-[var(--print-ink-secondary)]">{note}</span>}
      </span>
      <span className="shrink-0 font-mono tabular-nums text-[var(--print-ink)]">{value}</span>
    </div>
  )
}

export function ShiftReportPrint({ report }: { report: ShiftReport }) {
  const d = report.cashDrawer
  // The server sends the full identity block; a report already on screen from before that
  // (or any missing one) falls back to the current property's name, logo and colour.
  const { currentProperty } = useProperty()
  const brand =
    report.brand ??
    (currentProperty
      ? resolveStationeryBrand({
          name: currentProperty.name,
          logoUrl: currentProperty.logoUrl,
          bannerColor: currentProperty.bannerColor,
          stationeryFont: currentProperty.stationeryFont,
        })
      : null)
  const balanced = Math.abs(report.discrepancy) < 0.005
  return (
    <div className="hidden bg-white p-0 text-[var(--print-ink)] print:block">
      {brand ? (
        <StationeryHeader
          brand={brand}
          eyebrow="Cashiering"
          title="Cashier shift report"
          meta={[
            ...(report.cashierName ? [{ label: "Cashier", value: report.cashierName }] : []),
            ...(report.openedAt ? [{ label: "Opened", value: when(report.openedAt) }] : []),
            ...(report.closedAt ? [{ label: "Closed", value: when(report.closedAt) }] : []),
            ...(report.shift?.id ? [{ label: "Shift", value: report.shift.id.slice(0, 8).toUpperCase() }] : []),
          ]}
        />
      ) : (
        <header className="mb-5 border-b-2 border-[var(--print-ink)] pb-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--print-ink-secondary)]">{report.propertyName || "Cashiering"}</p>
          <h1 className="text-2xl font-bold">Cashier shift report</h1>
        </header>
      )}

      <Section title="Cash reconciliation">
        {d && (
          <>
            <Row label="Opening float" value={money(d.openingFloat)} />
            <Row label="Cash received" value={`+${money(d.cashIn)}`} />
            <Row label="Cash refunded" value={`−${money(d.cashOut)}`} />
            <Row label="Paid-outs" value={`−${money(d.paidOuts)}`} />
            <Row label="Currency exchanges (local cash)" value={`${d.exchangeNet < 0 ? "−" : "+"}${money(Math.abs(d.exchangeNet))}`} />
          </>
        )}
        <Row strong label="Expected in drawer" value={money(report.expectedCash)} />
        <Row label="Cash counted (confirmed)" value={money(report.actualDrop)} />
        <Row
          strong
          label="Difference"
          value={balanced ? "Balanced" : `${money(Math.abs(report.discrepancy))} ${report.discrepancy < 0 ? "short" : "over"}`}
        />
      </Section>

      <Section title="Payments by method">
        {(report.byMethod?.length ?? 0) === 0 ? (
          <p className="py-1 text-sm text-[var(--print-ink-secondary)]">No payments taken.</p>
        ) : (
          <>
            {report.byMethod!.map((m) => (
              <Row
                key={m.method}
                label={m.method}
                note={m.refunded > 0 ? `Received ${money(m.received)}, refunded ${money(m.refunded)}` : undefined}
                value={money(m.net)}
              />
            ))}
            <Row strong label="Total payments" value={money(report.byMethod!.reduce((s, m) => s + m.net, 0))} />
          </>
        )}
      </Section>

      {(report.paidOuts?.length ?? 0) > 0 && (
        <Section title="Paid-outs">
          {report.paidOuts!.map((p, i) => (
            <Row
              key={i}
              label={p.reason}
              note={[p.guest, p.room ? `Room ${p.room}` : null, when(p.at)].filter(Boolean).join(" · ")}
              value={`−${money(p.amount)}`}
            />
          ))}
        </Section>
      )}

      {(report.exchanges?.length ?? 0) > 0 && (
        <Section title="Currency exchanges">
          {report.exchanges!.map((x, i) => (
            <Row
              key={i}
              label={x.text}
              note={[x.guest, x.room ? `Room ${x.room}` : null, when(x.at)].filter(Boolean).join(" · ")}
              value=""
            />
          ))}
        </Section>
      )}

      <footer className="mt-8 grid grid-cols-2 gap-10 text-xs text-[var(--print-ink-secondary)]">
        <div className="border-t border-[var(--print-ink)] pt-1">Cashier signature</div>
        <div className="border-t border-[var(--print-ink)] pt-1">Supervisor signature</div>
      </footer>
    </div>
  )
}
