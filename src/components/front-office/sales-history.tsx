"use client"

import { useEffect, useState, useCallback } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Printer, Receipt, ReceiptText } from "@/components/icons"

export type SalesRow = {
  id: string
  date: string // ISO or yyyy-mm-dd — the sale's date
  time?: string | null
  guest: string
  item: string // treatment / excursion name
  amount?: number | null
  status: string // payment / booking status
  source: "guest" | "walkin"
  folioId: string | null
  folioClosed?: boolean
  taxInvoiceNumber?: string | null
}

// Shared History tab for Spa & Excursions — a browsable list of the module's sales,
// filterable by date, with Reprint (tax invoice) and, for walk-in bills, Open Bill (the
// existing walk-in panel handles reopen / void / take-payment / close there). In-house
// sales sit on the room folio, so they only reprint here.
export function SalesHistory({
  slug,
  refreshKey,
  load,
  onOpenWalkInBill,
}: {
  slug: string
  refreshKey?: number
  load: (date: string | null) => Promise<SalesRow[]>
  onOpenWalkInBill: (folioId: string) => void
}) {
  const [rows, setRows] = useState<SalesRow[]>([])
  const [date, setDate] = useState("")
  const [loading, setLoading] = useState(true)

  const run = useCallback(() => {
    setLoading(true)
    load(date || null)
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [load, date])

  useEffect(() => { run() }, [run, refreshKey])

  const money = (n?: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Filter by date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
        </div>
        {date && <Button variant="ghost" size="sm" onClick={() => setDate("")}>Clear</Button>}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={ReceiptText} title={date ? "No sales on this date" : "No sales yet"} className="py-10" />
      ) : (
        <div className="divide-y rounded-lg border">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {r.guest} <span className="text-muted-foreground font-normal">· {r.item}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(r.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}
                  {r.time ? ` · ${r.time}` : ""}
                  {r.taxInvoiceNumber ? ` · ${r.taxInvoiceNumber}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-[10px] uppercase">{r.source === "walkin" ? "Walk-in" : "Guest"}</Badge>
                <Badge variant="outline" className="text-[10px]">{r.status.replace(/_/g, " ")}</Badge>
                <span className="font-semibold text-foreground">{money(r.amount)}</span>
                {r.folioId && (
                  <Button size="sm" variant="outline" onClick={() => window.open(`/e/${slug}/dashboard/folios/${r.folioId}/print?type=tax`, "_blank")}>
                    <Printer className="w-4 h-4 mr-1.5" /> Reprint
                  </Button>
                )}
                {r.folioId && r.source === "walkin" && (
                  <Button size="sm" variant="outline" onClick={() => onOpenWalkInBill(r.folioId!)}>
                    <Receipt className="w-4 h-4 mr-1.5" /> Bill
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
