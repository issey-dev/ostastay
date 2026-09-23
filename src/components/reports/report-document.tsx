import type { ReportBranding, ReportColumn, ReportResult } from "@/lib/reports/types"
import { formatCell, isNumericColumn } from "@/lib/reports/format"
import { PRODUCT_NAME } from "@/lib/brand"

// ─── The report as a paper document ──────────────────────────────────────────
// ONE layout for every report, used twice:
//   · the Preview panel on the Reports page (on screen, inside the app)
//   · the report print page, which headless Chrome turns into the PDF
// so what the user previews is exactly what downloads. Palette-fixed (the --print-*
// tokens, never the theme ones): a report is paper, and stays light in dark mode, the
// same rule as every other printed document in the app.
//
// Server-safe: no hooks, no client-only APIs — the print page renders it on the server.

type Branding = Omit<ReportBranding, "generatedAt"> & { generatedAt: Date | string }

const alignClass = (col: ReportColumn) =>
  isNumericColumn(col) || col.align === "right" ? "text-right tabular-nums" : col.align === "center" ? "text-center" : "text-left"

function stamp(branding: Branding): string {
  const at = new Date(branding.generatedAt)
  const tz = branding.timeZone || "UTC"
  let when: string
  try {
    when = at.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz })
  } catch {
    when = at.toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC"
  }
  return `Generated ${when} by ${branding.generatedBy}`
}

export function ReportDocument({ result, branding }: { result: ReportResult; branding: Branding }) {
  const cols = result.columns
  const totalWeight = cols.reduce((s, c) => s + (c.width ?? 1), 0)
  const rowCount = result.groups ? result.groups.reduce((n, g) => n + g.rows.length, 0) : (result.rows?.length ?? 0)

  const cells = (row: Record<string, unknown>, strong = false) =>
    cols.map((col) => (
      <td
        key={col.key}
        className={`px-2 py-1.5 align-top ${alignClass(col)} ${strong ? "font-semibold text-[var(--print-ink)]" : ""}`}
      >
        {formatCell(row[col.key], col.format)}
      </td>
    ))

  return (
    <article className="report-document bg-white font-sans text-[11px] leading-snug text-[var(--print-ink-secondary)]">
      {/* Header — property identity left, product mark right, a single crimson rule
          under it: the same restraint as the app chrome (one brand accent, no fills). */}
      <header className="mb-4 border-b-2 border-[var(--print-accent)] pb-3">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--print-muted)]">
              {branding.propertyName}
              {branding.enterpriseName ? <span className="font-normal"> · {branding.enterpriseName}</span> : null}
            </p>
            <h1 className="mt-1 text-[20px] font-bold tracking-tight text-[var(--print-ink)]">{result.title}</h1>
            {result.subtitle && <p className="mt-0.5 text-[12px] text-[var(--print-ink-secondary)]">{result.subtitle}</p>}
          </div>
          <div className="shrink-0 text-right text-[10px] text-[var(--print-muted)]">
            <p className="font-semibold uppercase tracking-[0.14em] text-[var(--print-accent)]">{PRODUCT_NAME}</p>
            {branding.currency && <p className="mt-1">Currency: {branding.currency}</p>}
            <p>{rowCount} record{rowCount === 1 ? "" : "s"}</p>
          </div>
        </div>
        {result.note && <p className="mt-2 text-[10px] italic text-[var(--print-muted)]">{result.note}</p>}
      </header>

      <table className="w-full table-fixed border-collapse">
        <colgroup>
          {cols.map((c) => (
            <col key={c.key} style={{ width: `${((c.width ?? 1) / totalWeight) * 100}%` }} />
          ))}
        </colgroup>
        {/* thead repeats on every printed page (table-header-group). */}
        <thead>
          <tr className="border-b border-[var(--print-ink)]">
            {cols.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`px-2 pb-1.5 pt-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--print-muted)] ${alignClass(col)}`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>

        {result.groups ? (
          result.groups.map((g, gi) => (
            <tbody key={gi} className="report-group">
              <tr>
                <th
                  colSpan={cols.length}
                  scope="colgroup"
                  className="px-2 pb-1 pt-3 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--print-accent)]"
                >
                  {g.label}
                </th>
              </tr>
              {g.rows.map((row, i) => (
                <tr key={i} className="border-b border-[var(--print-border)] even:bg-[var(--print-surface)]/60">
                  {cells(row)}
                </tr>
              ))}
              {g.subtotals && (
                <tr className="border-b border-[var(--print-ink-secondary)]/40">
                  {cells({ ...g.subtotals, [cols[0].key]: "Subtotal" }, true)}
                </tr>
              )}
            </tbody>
          ))
        ) : (
          <tbody>
            {(result.rows ?? []).length === 0 ? (
              <tr>
                <td colSpan={cols.length} className="px-2 py-8 text-center text-[var(--print-muted)]">
                  No records for the selected parameters.
                </td>
              </tr>
            ) : (
              (result.rows ?? []).map((row, i) => (
                <tr key={i} className="border-b border-[var(--print-border)] even:bg-[var(--print-surface)]/60">
                  {cells(row)}
                </tr>
              ))
            )}
          </tbody>
        )}

        {result.totals && (
          <tfoot className="report-totals">
            <tr className="border-t-2 border-[var(--print-ink)]">{cells({ ...result.totals, [cols[0].key]: "Total" }, true)}</tr>
          </tfoot>
        )}
      </table>

      <footer className="mt-4 border-t border-[var(--print-border)] pt-2 text-[9px] text-[var(--print-faint)]">
        {branding.propertyName} · {stamp(branding)}
      </footer>
    </article>
  )
}
