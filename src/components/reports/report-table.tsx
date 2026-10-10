"use client"

import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { ChevronDown, ChevronRight, ChevronsUpDown, ArrowUp, Search, X } from "@/components/icons"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
import { formatCell, isNumericColumn } from "@/lib/reports/format"
import type { ReportColumn, ReportResult } from "@/lib/reports/types"

// The report's data on screen: a themed, sortable, searchable table — not the paper layout
// (that stays for print/PDF). Phones get cards instead of a many-column table.

type Row = Record<string, unknown>
type Sort = { key: string; dir: "asc" | "desc" } | null

const align = (c: ReportColumn) =>
  isNumericColumn(c) || c.align === "right" ? "text-right tabular-nums" : c.align === "center" ? "text-center" : "text-left"

function compare(a: unknown, b: unknown, col: ReportColumn): number {
  const blankA = a === null || a === undefined || a === ""
  const blankB = b === null || b === undefined || b === ""
  if (blankA || blankB) return blankA === blankB ? 0 : blankA ? 1 : -1 // blanks last
  if (isNumericColumn(col)) return Number(a) - Number(b)
  if (col.format === "date" || col.format === "datetime") return new Date(String(a)).getTime() - new Date(String(b)).getTime()
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" })
}

export function ReportTable({ result }: { result: ReportResult }) {
  const cols = result.columns
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<Sort>(null)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  // Phones render cards, 15 at a time — 50 cards in one scroll is a wall.
  const [phoneLimit, setPhoneLimit] = useState(15)

  const q = query.trim().toLowerCase()
  const col = sort ? cols.find((c) => c.key === sort.key) : undefined

  const prepare = (rows: Row[]) => {
    let out = rows
    if (q) out = out.filter((r) => cols.some((c) => formatCell(r[c.key], c.format).toLowerCase().includes(q)))
    if (sort && col) {
      const dir = sort.dir === "asc" ? 1 : -1
      out = [...out].sort((a, b) => dir * compare(a[sort.key], b[sort.key], col))
    }
    return out
  }

  const view = useMemo(
    () => (result.groups ? result.groups.map((g) => ({ ...g, shown: prepare(g.rows) })) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, q, sort]
  )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const flat = useMemo(() => (result.groups ? null : prepare(result.rows ?? [])), [result, q, sort])

  const total = result.groups ? result.groups.reduce((n, g) => n + g.rows.length, 0) : (result.rows?.length ?? 0)
  const shownCount = view ? view.reduce((n, g) => n + g.shown.length, 0) : (flat?.length ?? 0)

  const toggleSort = (key: string) =>
    setSort((s) => (!s || s.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null))

  const cell = (row: Row, c: ReportColumn) => formatCell(row[c.key], c.format)

  const totalsRow = result.totals && (
    <tr className="sticky bottom-0 border-t-2 border-border bg-muted/80 font-semibold backdrop-blur-sm">
      {cols.map((c, i) => (
        <td key={c.key} className={cn("px-3 py-2", align(c))}>
          {i === 0 ? "Total" : cell(result.totals as Row, c)}
        </td>
      ))}
    </tr>
  )

  if (total === 0) {
    return <EmptyState size="default" title="No records" description="Nothing matches these parameters. Try another date or filter." className="rounded-2xl bg-card py-12 ring-1 ring-foreground/5" />
  }

  // First column is the headline, the next few are its facts.
  const phoneCard = (row: Row, key: string | number) => (
    <MobileCard
      key={key}
      title={cell(row, cols[0]) || "—"}
      subtitle={cols[1] ? cell(row, cols[1]) : undefined}
      meta={cols.slice(2, 6).map((c) => ({ label: c.label, value: cell(row, c) || "—" }))}
    />
  )

  // The phone card list as a flat sequence (group headings + cards), so it can be cut at a limit.
  const phoneItems: { heading?: string; row?: Row; key: string }[] = view
    ? view.flatMap((g, gi) =>
        g.shown.length === 0 ? [] : [{ heading: g.label, key: `h${gi}` }, ...g.shown.map((r, i) => ({ row: r, key: `${gi}-${i}` }))]
      )
    : flat!.map((r, i) => ({ row: r, key: String(i) }))
  const phoneRows = phoneItems.filter((x) => x.row).length
  let seen = 0
  const phoneShown = phoneItems.filter((x) => (x.row ? ++seen <= phoneLimit : true))

  return (
    <section aria-label="Report data" className="overflow-hidden rounded-2xl bg-card shadow-elevation-1 ring-1 ring-foreground/5">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="mr-auto text-sm font-semibold text-foreground">
          Details{" "}
          <span className="font-normal text-muted-foreground">
            · {q ? `${shownCount} of ${total}` : total} record{total === 1 ? "" : "s"}
          </span>
        </h2>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search this report" className="pl-8" aria-label="Search this report" />
        </div>
        {result.groups && result.groups.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(result.groups!.map((_, i) => i)))}
          >
            {collapsed.size ? "Expand all" : "Collapse all"}
          </Button>
        )}
        {(q || sort) && (
          <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={() => { setQuery(""); setSort(null) }}>
            <X className="h-3.5 w-3.5" /> Reset
          </Button>
        )}
      </div>

      {/* Desktop / tablet */}
      <div className="hidden max-h-[70vh] overflow-auto md:block">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm">
            <tr>
              {cols.map((c) => {
                const active = sort?.key === c.key
                return (
                  <th key={c.key} scope="col" aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"} className={cn("px-3 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase", align(c))}>
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={cn("inline-flex items-center gap-1 rounded-sm uppercase hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", align(c) === "text-right tabular-nums" && "flex-row-reverse")}
                    >
                      {c.label}
                      {active ? <ArrowUp className={cn("h-3 w-3 text-foreground", sort!.dir === "desc" && "rotate-180")} /> : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          {view ? (
            view.map((g, gi) => {
              const open = !collapsed.has(gi)
              if (q && g.shown.length === 0) return null
              return (
                <tbody key={gi}>
                  <tr className="border-b border-border bg-muted/40">
                    <th colSpan={cols.length} scope="colgroup" className="px-3 py-1.5 text-left">
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(gi)) n.delete(gi); else n.add(gi); return n })}
                        className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-primary uppercase focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        {g.label}
                        <span className="font-normal text-muted-foreground normal-case">· {g.shown.length}</span>
                      </button>
                    </th>
                  </tr>
                  {open && g.shown.map((r, i) => <DataRow key={i} row={r} cols={cols} />)}
                  {open && g.subtotals && !q && (
                    <tr className="border-b border-border bg-muted/20 font-medium">
                      {cols.map((c, i) => (
                        <td key={c.key} className={cn("px-3 py-1.5", align(c))}>{i === 0 ? "Subtotal" : cell(g.subtotals as Row, c)}</td>
                      ))}
                    </tr>
                  )}
                </tbody>
              )
            })
          ) : (
            <tbody>{flat!.map((r, i) => <DataRow key={i} row={r} cols={cols} />)}</tbody>
          )}
          {!q && <tfoot>{totalsRow}</tfoot>}
        </table>
        {shownCount === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No rows match &ldquo;{query}&rdquo;.</p>}
      </div>

      {/* Phones */}
      <div className="p-3 md:hidden">
        <MobileCardList empty={<p className="py-6 text-center text-sm text-muted-foreground">No rows match &ldquo;{query}&rdquo;.</p>}>
          {phoneShown.map((x) =>
            x.heading ? (
              <p key={x.key} className="sticky top-0 z-[1] -mx-3 bg-card/95 px-3 py-1.5 text-xs font-semibold tracking-wide text-primary uppercase backdrop-blur-sm">{x.heading}</p>
            ) : (
              phoneCard(x.row!, x.key)
            )
          )}
        </MobileCardList>
        {phoneRows > phoneLimit && (
          <Button variant="outline" className="mt-3 w-full" onClick={() => setPhoneLimit((n) => n + 15)}>
            Show more ({phoneRows - phoneLimit} left)
          </Button>
        )}
        {result.totals && !q && (
          <div className="mt-3 rounded-xl bg-muted/60 p-3 text-sm font-semibold">
            Total {cols.filter((c, i) => i > 0 && result.totals![c.key] !== undefined && result.totals![c.key] !== "").map((c) => `· ${c.label}: ${cell(result.totals as Row, c)}`).join(" ")}
          </div>
        )}
      </div>
    </section>
  )
}

function DataRow({ row, cols }: { row: Row; cols: ReportColumn[] }) {
  return (
    <tr className="border-b border-border/60 transition-colors hover:bg-muted/40">
      {cols.map((c) => (
        <td key={c.key} className={cn("px-3 py-2 align-top", align(c))}>
          {formatCell(row[c.key], c.format) || <span className="text-muted-foreground/60">—</span>}
        </td>
      ))}
    </tr>
  )
}
