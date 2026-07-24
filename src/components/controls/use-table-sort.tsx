"use client"

import * as React from "react"
import { ArrowUp } from "@/components/icons"
import { TableHead } from "@/components/ui/table"
import { cn } from "@/lib/utils"

// Shared first-column table sorting for the Controls section (Settings.dc.html design).
// Deliberately small: one hook that owns the {column, dir} state and returns a sorted
// copy, plus one <SortableTableHead> that renders the clickable header with its arrow.
// Per the agreed behaviour it's a two-state toggle — ascending <-> descending, no
// "unsorted" third state — and by default a table opens sorted ascending on its first
// column, which is the "first column is the sort column" ask. Any column CAN be wired
// (pass its key + accessor), but callers here only ever make the first one sortable.
//
// Not a generic DataTable: it doesn't own rendering, pagination, or selection. Callers
// keep their existing <Table>/<TableRow> markup and just (1) feed rows through `sorted`
// and (2) swap their first <TableHead> for <SortableTableHead>. Tables whose row order
// is itself meaningful, user-editable data (e.g. the dropdown reorder list) are left
// alone — sorting them would misrepresent the data.

export type SortDir = "asc" | "desc"

// A value extracted from a row for comparison. null/undefined always sort last,
// regardless of direction, so empty cells don't jump to the top on desc.
export type SortValue = string | number | null | undefined

export type TableSort<K extends string> = {
  column: K
  dir: SortDir
  /** Toggle direction if `column` is already active, else switch to it ascending. */
  toggle: (column: K) => void
  /** True when `column` is the active sort column. */
  isActive: (column: K) => boolean
}

export function useTableSort<T, K extends string>(
  rows: T[],
  accessors: Record<K, (row: T) => SortValue>,
  initialColumn: K,
  initialDir: SortDir = "asc"
): { sorted: T[]; sort: TableSort<K> } {
  const [column, setColumn] = React.useState<K>(initialColumn)
  const [dir, setDir] = React.useState<SortDir>(initialDir)

  const toggle = React.useCallback(
    (next: K) => {
      if (next === column) {
        setDir((d) => (d === "asc" ? "desc" : "asc"))
      } else {
        setColumn(next)
        setDir("asc")
      }
    },
    [column]
  )

  const sorted = React.useMemo(() => {
    const accessor = accessors[column]
    if (!accessor) return rows
    const factor = dir === "asc" ? 1 : -1
    // A copy — never sort the caller's array in place.
    return [...rows].sort((a, b) => {
      const av = accessor(a)
      const bv = accessor(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1 // nullish last, both directions
      if (bv == null) return -1
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor
      // localeCompare with numeric:true so "Room 2" < "Room 10" and codes sort naturally.
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * factor
    })
    // accessors is expected to be a stable/inline object; intentionally excluded from deps
    // to avoid re-sorting every render when a caller passes a fresh literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, column, dir])

  return { sorted, sort: { column, dir, toggle, isActive: (c) => c === column } }
}

// The clickable header cell. Mirrors the label styling the Controls tables already used
// on their <TableHead>s (uppercase, tracked, xs, muted) so sortable and plain headers
// sit together cleanly. The arrow sits at low opacity until the column is active, then
// flips between up/down — matching the Settings.dc.html header.
export function SortableTableHead<K extends string>({
  columnKey,
  sort,
  align = "left",
  className,
  children,
  ...props
}: {
  columnKey: K
  sort: TableSort<K>
  align?: "left" | "right"
  children: React.ReactNode
} & Omit<React.ComponentProps<typeof TableHead>, "children">) {
  const active = sort.isActive(columnKey)
  return (
    <TableHead
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn(align === "right" && "text-right", className)}
      {...props}
    >
      <button
        type="button"
        onClick={() => sort.toggle(columnKey)}
        className={cn(
          "group inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-colors",
          align === "right" && "flex-row-reverse",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        {children}
        <ArrowUp
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-[transform,opacity] duration-150",
            active ? "opacity-100" : "opacity-30 group-hover:opacity-60",
            active && sort.dir === "desc" && "rotate-180"
          )}
        />
      </button>
    </TableHead>
  )
}
