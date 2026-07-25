"use client"

import { useEffect, useState, useCallback } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Receipt } from "@/components/icons"

type Row = {
  id: string
  walkInGuestName: string | null
  taxInvoiceNumber: string | null
  closedBusinessDate: string | null
  charges: number
  payments: number
  balance: number
  reopenable: boolean
}

// Closed walk-in (Fast Post) bills, filterable by date. Opening a row shows the bill in
// the modal; same-business-day bills can be reopened there for adjustments.
export function WalkInHistory({ propertyId, refreshKey, onOpen }: { propertyId: string; refreshKey?: number; onOpen: (folioId: string) => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [date, setDate] = useState("")
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    if (!propertyId) return
    setLoading(true)
    const qs = new URLSearchParams({ propertyId })
    if (date) qs.set("date", date)
    fetch(`/api/folios/walk-in?${qs}`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setRows(d) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [propertyId, date])

  useEffect(() => { load() }, [load, refreshKey])

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
        <EmptyState icon={Receipt} title={date ? "No closed bills on this date" : "No closed walk-in bills yet"} className="py-10" />
      ) : (
        <div className="divide-y rounded-lg border">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{r.walkInGuestName || "Walk-in"}</p>
                <p className="text-xs text-muted-foreground">
                  {r.taxInvoiceNumber ? `${r.taxInvoiceNumber} · ` : ""}
                  {r.closedBusinessDate ? new Date(r.closedBusinessDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : ""}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="font-semibold text-foreground">${r.charges.toFixed(2)}</p>
                  {Math.abs(r.balance) > 0.01 && <p className="text-xs text-destructive">Balance ${r.balance.toFixed(2)}</p>}
                </div>
                {r.reopenable && <Badge variant="outline" className="border-success/40 text-success">Same day</Badge>}
                <Button size="sm" variant="outline" onClick={() => onOpen(r.id)}>Open</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
