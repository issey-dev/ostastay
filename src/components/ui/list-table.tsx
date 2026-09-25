"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { ArrowUp, Download } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { ErrorState } from "@/components/ui/error-state"

// The list page table (DESKTOP_PLAN §3.5, D9). One implementation so every list reads the
// same: header row that stays in view on desktop, click-to-sort columns, a result count
// ("50 of 312"), a whole row that opens the record — with the primary cell a real <Link> so
// Ctrl/middle-click and "open in new tab" work — and the shared loading / error / empty
// states. Phones keep their own MobileCardList: pass it as `mobile` and it renders below md.
//
//   <ListTable
//     rows={debtors} rowKey={(d) => d.id} rowHref={(d) => `${base}/debtors/${d.upid}`}
//     columns={[
//       { key: "name", header: "Account", cell: (d) => d.name, sortValue: (d) => d.name, primary: true },
//       { key: "balance", header: "Balance", align: "right", cell: (d) => money(d.balance), sortValue: (d) => d.balance },
//     ]}
//     total={count} loading={loading} error={error} onRetry={load}
//     empty={{ icon: Landmark, title: "No debtor accounts yet" }}
//     exportName="debtors"
//   />

export type ListColumn<T> = {
  key: string
  header: React.ReactNode
  cell: (row: T) => React.ReactNode
  /** Makes the column sortable (client-side, over the rows passed in). */
  sortValue?: (row: T) => string | number | null | undefined
  /** CSV value; defaults to sortValue, then to nothing (column left out of the export). */
  csv?: (row: T) => string | number | null | undefined
  align?: "left" | "right" | "center"
  className?: string
  headClassName?: string
  /** The cell that becomes the row's link (one per table). */
  primary?: boolean
}

type SortState = { key: string; dir: "asc" | "desc" } | null

export function ListTable<T>({
  rows,
  columns,
  rowKey,
  rowHref,
  onRowClick,
  total,
  loading,
  error,
  onRetry,
  empty,
  exportName,
  defaultSort = null,
  mobile,
  toolbar,
  className,
}: {
  rows: T[]
  columns: ListColumn<T>[]
  rowKey: (row: T) => string
  rowHref?: (row: T) => string
  onRowClick?: (row: T) => void
  /** Total matching records on the server, when more exist than were loaded. */
  total?: number
  loading?: boolean
  error?: boolean
  onRetry?: () => void
  empty?: { icon?: React.ComponentType<{ className?: string }>; title: string; description?: string; action?: React.ReactNode }
  /** Adds "Export CSV" (file name without extension). */
  exportName?: string
  defaultSort?: SortState
  /** Phone rendering (below md); the table is desktop/tablet only when this is given. */
  mobile?: React.ReactNode
  /** Right side of the count line (e.g. a column toggle or bulk action). */
  toolbar?: React.ReactNode
  className?: string
}) {
  const router = useRouter()
  const [sort, setSort] = React.useState<SortState>(defaultSort)

  const sorted = React.useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return rows
    const get = col.sortValue
    const dir = sort!.dir === "asc" ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = get(a)
      const vb = get(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir
      return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" }) * dir
    })
  }, [rows, columns, sort])

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }))

  const exportCsv = () => {
    const cols = columns.filter((c) => c.csv || c.sortValue)
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const header = cols.map((c) => esc(typeof c.header === "string" ? c.header : c.key)).join(",")
    const body = sorted.map((r) => cols.map((c) => esc((c.csv ?? c.sortValue)!(r))).join(",")).join("\n")
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${exportName}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const clickable = !!(rowHref || onRowClick)
  const open = (row: T) => {
    if (onRowClick) onRowClick(row)
    else if (rowHref) router.push(rowHref(row))
  }

  let body: React.ReactNode
  if (error) {
    body = <ErrorState onRetry={onRetry} />
  } else if (loading && rows.length === 0) {
    body = (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    )
  } else if (rows.length === 0) {
    body = <EmptyState icon={empty?.icon} title={empty?.title ?? "Nothing here"} description={empty?.description} action={empty?.action} />
  } else {
    body = (
      <>
        {mobile && <div className="md:hidden">{mobile}</div>}
        <div className={cn("overflow-x-auto lg:overflow-x-visible", mobile && "max-md:hidden")}>
          <table className="w-full caption-bottom text-sm">
            <thead className="bg-card lg:sticky lg:top-16 lg:z-10">
              <tr className="border-b border-border">
                {columns.map((c) => {
                  const active = sort?.key === c.key
                  const alignCls = c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left"
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                      className={cn("h-10 px-3 font-medium whitespace-nowrap text-muted-foreground first:pl-4 last:pr-4", alignCls, c.headClassName)}
                    >
                      {c.sortValue ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(c.key)}
                          className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground", c.align === "right" && "flex-row-reverse")}
                        >
                          {c.header}
                          <ArrowUp className={cn("h-3.5 w-3.5 transition-transform", !active && "opacity-0", active && sort!.dir === "desc" && "rotate-180")} />
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={clickable ? () => open(row) : undefined}
                  className={cn("border-b border-border last:border-0 transition-colors hover:bg-muted/50", clickable && "cursor-pointer")}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "px-3 py-2.5 align-middle first:pl-4 last:pr-4",
                        c.align === "right" && "text-right tabular-nums",
                        c.align === "center" && "text-center",
                        c.className
                      )}
                    >
                      {c.primary && rowHref ? (
                        <Link href={rowHref(row)} onClick={(e) => e.stopPropagation()} className="font-medium text-foreground hover:underline">
                          {c.cell(row)}
                        </Link>
                      ) : (
                        c.cell(row)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )
  }

  const shown = rows.length
  return (
    <div className={cn("border border-border bg-card", className)}>
      {body}
      {!error && shown > 0 && (
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {total !== undefined && total > shown ? `${shown} of ${total}` : `${shown} ${shown === 1 ? "result" : "results"}`}
          </span>
          <div className="flex items-center gap-2">
            {toolbar}
            {exportName && (
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs max-md:hidden" onClick={exportCsv}>
                <Download className="h-3.5 w-3.5" /> Export CSV
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
