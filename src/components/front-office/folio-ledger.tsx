"use client"

import { Fragment, useState } from "react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Ban, ChevronDown, ChevronRight, Hash, MoreHorizontal, Printer, Receipt } from "@/components/icons"
import { EmptyState } from "@/components/ui/empty-state"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { rollUpByCheck, type LedgerEntry } from "@/lib/folio-presentation"
import type { CheckNoTarget } from "@/components/front-office/folio-check-no-dialog"

// The folio's ledger — desktop table and phone list. Lines posted together (a charge and
// its Service Charge / GST / levies; a Night Audit night) share a check number and roll up
// into one row here (owner, 2026-09-26: "make the folio look clean"). Expanding a row shows
// its parts with their own actions. Payments never roll up.

type Line = {
  id: string
  date: string
  description: string
  amount: number
  taxAmount: number
  serviceChargeAmount: number
  isVoid?: boolean
  checkNo?: string | null
  generatedFromLineItemId?: string | null
  roomAssignmentId?: string | null
  createdAt?: string | null
  folioId?: string | null
}
type CheckEntry = Extract<LedgerEntry<Line>, { kind: "check" }>

type FolioLedgerProps = {
  folio: { id: string; isClosed?: boolean; lineItems: Line[]; payments: any[] }
  slug: string
  selectedIds: string[]
  onSelectedIdsChange: (ids: string[]) => void
  onVoidLine: (line: Line) => void
  onVoidGroup: (lines: Line[]) => void
  onEditCheckNo: (target: CheckNoTarget) => void
}

const lineTotal = (l: Line) => l.amount + (l.serviceChargeAmount || 0) + l.taxAmount
const money = (n: number) => `$${n.toFixed(2)}`
const shortDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }).replace(/ /g, "-")
const dayMonth = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).replace(/ /g, "-")

// The menus sit inside clickable phone rows; React events bubble out of the menu's portal
// into the row, so a menu click must not also select / expand the row.
function StopClicks({ children }: { children: React.ReactNode }) {
  return <span className="contents" onClick={(e) => e.stopPropagation()}>{children}</span>
}

export function FolioLedger({ folio, slug, selectedIds, onSelectedIdsChange, onVoidLine, onVoidGroup, onEditCheckNo }: FolioLedgerProps) {
  const entries = rollUpByCheck(folio.lineItems)
  const groups = entries.filter((e): e is CheckEntry => e.kind === "check")
  // Collapsed by default. Kept per check key, so a refresh after an edit keeps what the
  // cashier had open.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const allExpanded = groups.length > 0 && groups.every((g) => expanded.has(g.key))
  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const setAllExpanded = (open: boolean) => setExpanded(open ? new Set(groups.map((g) => g.key)) : new Set())

  const selected = new Set(selectedIds)
  const liveIds = folio.lineItems.filter((i) => !i.isVoid).map((i) => i.id)
  const toggleIds = (ids: string[], on: boolean) => {
    const next = new Set(selectedIds)
    for (const id of ids) {
      if (on) next.add(id)
      else next.delete(id)
    }
    onSelectedIdsChange([...next])
  }
  const groupIds = (g: CheckEntry) => g.lines.map((l) => l.id)
  const groupSelected = (g: CheckEntry) => g.lines.every((l) => selected.has(l.id))
  const canAct = !folio.isClosed
  const empty = folio.lineItems.length === 0 && folio.payments.length === 0

  const expandToggle = groups.length > 0 && (
    <button
      type="button"
      onClick={() => setAllExpanded(!allExpanded)}
      className="text-xs font-normal text-muted-foreground hover:text-foreground"
    >
      {allExpanded ? "Collapse all" : "Expand all"}
    </button>
  )

  // ── Actions ────────────────────────────────────────────────────────────────────────
  const lineActions = (line: Line, size: "sm" | "md") =>
    !line.isVoid && canAct ? (
      <StopClicks>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon"
              variant="ghost"
              className={cn("shrink-0 text-muted-foreground", size === "sm" ? "h-7 w-7" : "h-8 w-8")}
              aria-label={`Actions for ${line.description}`}
            />
          }
        >
          <MoreHorizontal className={size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => onEditCheckNo({ lineItemIds: [line.id], checkNo: line.checkNo ?? null, label: line.description })}
          >
            <Hash className="h-4 w-4 mr-2" /> Edit check number
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" className="cursor-pointer" onClick={() => onVoidLine(line)}>
            <Ban className="h-4 w-4 mr-2" /> Void charge
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </StopClicks>
    ) : null

  const groupActions = (g: CheckEntry, size: "sm" | "md") =>
    canAct ? (
      <StopClicks>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon"
              variant="ghost"
              className={cn("shrink-0 text-muted-foreground", size === "sm" ? "h-7 w-7" : "h-8 w-8")}
              aria-label={`Actions for ${g.main.description}`}
            />
          }
        >
          <MoreHorizontal className={size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() =>
              onEditCheckNo({ lineItemIds: groupIds(g), checkNo: g.checkNo, label: `${g.main.description} and ${g.lines.length - 1} more line${g.lines.length === 2 ? "" : "s"}` })
            }
          >
            <Hash className="h-4 w-4 mr-2" /> Edit check number
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" className="cursor-pointer" onClick={() => onVoidGroup(g.lines)}>
            <Ban className="h-4 w-4 mr-2" /> Void all {g.lines.length} lines
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </StopClicks>
    ) : null

  const receiptButton = (payment: any, size: "sm" | "md") => (
    <Button
      size="icon"
      variant="ghost"
      className={cn("shrink-0", size === "sm" ? "h-7 w-7" : "h-8 w-8")}
      title="Print payment receipt"
      aria-label="Print payment receipt"
      onClick={() => window.open(`/e/${slug}/dashboard/payments/${payment.id}/receipt`, "_blank")}
    >
      <Printer className={size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"} />
    </Button>
  )

  // ── Desktop rows ───────────────────────────────────────────────────────────────────
  const desktopLine = (item: Line, nested = false) => {
    const strike = item.isVoid ? "line-through text-muted-foreground" : ""
    return (
      <TableRow
        key={item.id}
        className={cn(item.isVoid ? "opacity-50" : selected.has(item.id) ? "bg-muted/30" : "", nested && "bg-muted/20 text-sm")}
      >
        <TableCell className="text-center">
          {!item.isVoid && (
            <Checkbox
              aria-label={`Select ${item.description}`}
              checked={selected.has(item.id)}
              onCheckedChange={(on) => toggleIds([item.id], !!on)}
            />
          )}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">{shortDate(item.date)}</TableCell>
        <TableCell className={cn(strike, nested && "pl-9")}>
          {item.description}
          {item.isVoid && <Badge variant="outline" className="ml-2 no-underline">VOID</Badge>}
        </TableCell>
        <TableCell className={cn("text-right", strike)}>{money(item.amount)}</TableCell>
        <TableCell className={cn("text-right text-muted-foreground", item.isVoid && "line-through")}>{money(item.serviceChargeAmount || 0)}</TableCell>
        <TableCell className={cn("text-right text-muted-foreground", item.isVoid && "line-through")}>{money(item.taxAmount)}</TableCell>
        <TableCell className={cn("text-right", item.isVoid ? "line-through text-muted-foreground" : nested ? "text-muted-foreground" : "font-medium text-destructive")}>
          {money(lineTotal(item))}
        </TableCell>
        <TableCell className="text-right text-muted-foreground">-</TableCell>
        <TableCell>{lineActions(item, "sm")}</TableCell>
      </TableRow>
    )
  }

  const desktopGroup = (g: CheckEntry) => {
    const open = expanded.has(g.key)
    const Chevron = open ? ChevronDown : ChevronRight
    return (
      <Fragment key={g.key}>
        <TableRow className={groupSelected(g) ? "bg-muted/30" : ""}>
          <TableCell className="text-center">
            <Checkbox
              aria-label={`Select ${g.main.description} and its lines`}
              checked={groupSelected(g)}
              onCheckedChange={(on) => toggleIds(groupIds(g), !!on)}
            />
          </TableCell>
          <TableCell className="text-xs text-muted-foreground">{shortDate(String(g.date))}</TableCell>
          <TableCell>
            <button
              type="button"
              onClick={() => toggleExpanded(g.key)}
              aria-expanded={open}
              title={`Check ${g.checkNo} · ${g.lines.length} lines`}
              className="-ml-1 inline-flex items-center gap-1 text-left hover:text-primary"
            >
              <Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {g.main.description}
            </button>
            {open && <span className="ml-2 text-xs text-muted-foreground">Check {g.checkNo}</span>}
          </TableCell>
          <TableCell className="text-right">{money(g.base)}</TableCell>
          <TableCell className="text-right text-muted-foreground">{money(g.serviceCharge)}</TableCell>
          <TableCell className="text-right text-muted-foreground">{money(g.tax)}</TableCell>
          <TableCell className="text-right font-medium text-destructive">{money(g.total)}</TableCell>
          <TableCell className="text-right text-muted-foreground">-</TableCell>
          <TableCell>{groupActions(g, "sm")}</TableCell>
        </TableRow>
        {open && g.lines.map((l) => desktopLine(l, true))}
      </Fragment>
    )
  }

  // ── Phone rows ─────────────────────────────────────────────────────────────────────
  const phoneLine = (item: Line, nested = false) => {
    const isSel = selected.has(item.id)
    return (
      <div
        key={item.id}
        className={cn(
          "flex items-center gap-2 px-3 py-2.5",
          item.isVoid ? "opacity-50" : isSel ? "bg-primary/5" : "",
          !item.isVoid && "cursor-pointer active:bg-muted/50",
          nested && "bg-muted/20 pl-9"
        )}
        onClick={() => { if (!item.isVoid) toggleIds([item.id], !isSel) }}
      >
        {!item.isVoid && (
          <Checkbox
            className="shrink-0"
            aria-label={`Select ${item.description}`}
            checked={isSel}
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={(on) => toggleIds([item.id], !!on)}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm font-medium", item.isVoid && "line-through text-muted-foreground", nested && "font-normal")}>
            {item.description}
            {item.isVoid && <Badge variant="outline" className="ml-2 no-underline">VOID</Badge>}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {dayMonth(item.date)}
            {" · "}{money(item.amount)} + SC {money(item.serviceChargeAmount || 0)} + tax {money(item.taxAmount)}
          </p>
        </div>
        <span className={cn("shrink-0 text-sm font-semibold tabular-nums", item.isVoid ? "line-through text-muted-foreground" : nested ? "font-normal text-muted-foreground" : "text-destructive")}>
          {money(lineTotal(item))}
        </span>
        {lineActions(item, "md")}
      </div>
    )
  }

  const phoneGroup = (g: CheckEntry) => {
    const open = expanded.has(g.key)
    const Chevron = open ? ChevronDown : ChevronRight
    const isSel = groupSelected(g)
    return (
      <Fragment key={g.key}>
        <div
          className={cn("flex items-center gap-2 px-3 py-2.5 cursor-pointer active:bg-muted/50", isSel && "bg-primary/5")}
          onClick={() => toggleExpanded(g.key)}
          aria-expanded={open}
        >
          <Checkbox
            className="shrink-0"
            aria-label={`Select ${g.main.description} and its lines`}
            checked={isSel}
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={(on) => toggleIds(groupIds(g), !!on)}
          />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 text-sm font-medium">
              <Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{g.main.description}</span>
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {dayMonth(String(g.date))}
              {" · "}{g.lines.length} lines{open ? ` · check ${g.checkNo}` : ""}
            </p>
          </div>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-destructive">{money(g.total)}</span>
          {groupActions(g, "md")}
        </div>
        {open && g.lines.map((l) => phoneLine(l, true))}
      </Fragment>
    )
  }

  return (
    <>
      {/* Phone view — the table below takes over at md. One compact row per posting (or
          per check); tapping a charge selects it for "Move to folio", tapping a rolled-up
          check opens it. */}
      <div className="md:hidden divide-y divide-border">
        {empty ? (
          <EmptyState icon={Receipt} title="No transactions posted yet" />
        ) : (
          <>
            {expandToggle && <div className="flex justify-end px-3 py-1.5">{expandToggle}</div>}
            {entries.map((e) => (e.kind === "check" ? phoneGroup(e) : phoneLine(e.line)))}
            {folio.payments.map((payment: any) => (
              <div key={payment.id} className="flex items-center gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">Payment - {payment.paymentMethod?.name}</p>
                  <p className="text-[11px] text-muted-foreground">{dayMonth(payment.createdAt)}</p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-success">{money(payment.amount)}</span>
                {receiptButton(payment, "md")}
              </div>
            ))}
          </>
        )}
      </div>

      <div className="hidden md:block">
        <Table>
          <TableHeader className="bg-muted sticky top-0 z-10 shadow-sm">
            <TableRow>
              <TableHead className="w-12 text-center">
                <Checkbox
                  aria-label="Select all charges"
                  checked={liveIds.length > 0 && liveIds.every((id) => selected.has(id))}
                  onCheckedChange={(on) => onSelectedIdsChange(on ? liveIds : [])}
                />
              </TableHead>
              <TableHead>Date</TableHead>
              <TableHead>
                <div className="flex items-center justify-between gap-3">
                  <span>Description</span>
                  {expandToggle}
                </div>
              </TableHead>
              <TableHead className="text-right">Base</TableHead>
              <TableHead className="text-right">SC</TableHead>
              <TableHead className="text-right">Tax</TableHead>
              <TableHead className="text-right">Total charge</TableHead>
              <TableHead className="text-right">Payment</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (e.kind === "check" ? desktopGroup(e) : desktopLine(e.line)))}
            {folio.payments.map((payment: any) => (
              <TableRow key={payment.id}>
                <TableCell></TableCell>
                <TableCell className="text-xs text-muted-foreground">{shortDate(payment.createdAt)}</TableCell>
                <TableCell>Payment - {payment.paymentMethod?.name}</TableCell>
                <TableCell className="text-right text-muted-foreground">-</TableCell>
                <TableCell className="text-right text-muted-foreground">-</TableCell>
                <TableCell className="text-right text-muted-foreground">-</TableCell>
                <TableCell className="text-right text-muted-foreground">-</TableCell>
                <TableCell className="text-right font-medium text-success">{money(payment.amount)}</TableCell>
                <TableCell>{receiptButton(payment, "sm")}</TableCell>
              </TableRow>
            ))}
            {empty && (
              <TableRow>
                <TableCell colSpan={9} className="py-0">
                  <EmptyState icon={Receipt} title="No transactions posted yet" />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
