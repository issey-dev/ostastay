"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { DatePicker } from "@/components/ui/date-picker"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Receipt } from "@/components/icons"
import { useProperty } from "@/components/providers/property-provider"
import { toast } from "@/lib/toast"

type Row = {
  id: string
  walkInGuestName: string | null
  taxInvoiceNumber: string | null
  outletCheckNumber: string | null
  outletName: string | null
  isClosed: boolean
  // Business date: when a closed bill was closed, or when an open one was last posted to.
  closedBusinessDate: string | null
  charges: number
  payments: number
  balance: number
  reopenable: boolean
}

type Posting = {
  id: string
  folioId: string
  folioNumber: number
  reservationId: string | null
  room: string
  guest: string
  description: string
  outletName: string | null
  checkNumber: string | null
  date: string
  total: number
  isVoid: boolean
  folioClosed: boolean
}

const fmtDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : ""

// Fast Post history for one business date — it opens on the property's current business
// date, so the desk sees today's work straight away. Two lists: charges keyed in onto room
// folios (open the folio, or void a mistake while the folio is open) and walk-in bills
// (open to settle/close, or reopen a same-day closed bill).
export function WalkInHistory({ propertyId, refreshKey, onOpen }: { propertyId: string; refreshKey?: number; onOpen: (folioId: string) => void }) {
  const { slug } = useParams<{ slug: string }>()
  const { currentProperty } = useProperty()
  const businessDate = currentProperty?.businessDate?.slice(0, 10) ?? ""

  const [rows, setRows] = useState<Row[]>([])
  const [postings, setPostings] = useState<Posting[]>([])
  // `null` = not chosen yet, so the picker follows the business date; "" = cleared (all dates).
  const [picked, setPicked] = useState<string | null>(null)
  const date = picked ?? businessDate
  const [loading, setLoading] = useState(true)

  const [voidTarget, setVoidTarget] = useState<Posting | null>(null)
  const [voidReason, setVoidReason] = useState("")
  const [voiding, setVoiding] = useState(false)

  const load = useCallback(() => {
    if (!propertyId) return
    setLoading(true)
    const qs = new URLSearchParams({ propertyId })
    if (date) qs.set("date", date)
    Promise.all([
      fetch(`/api/folios/walk-in?${qs}`).then((r) => r.json()),
      fetch(`/api/pos/postings?${qs}`).then((r) => r.json()),
    ])
      .then(([bills, posts]) => {
        setRows(Array.isArray(bills) ? bills : [])
        setPostings(Array.isArray(posts) ? posts : [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [propertyId, date])

  useEffect(() => { load() }, [load, refreshKey])

  const handleVoid = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!voidTarget || !voidReason.trim() || voiding) return
    setVoiding(true)
    try {
      const res = await fetch(`/api/folios/${voidTarget.folioId}/line-items/${voidTarget.id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: voidReason.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success("Posting voided", { description: voidTarget.description })
        setVoidTarget(null)
        setVoidReason("")
        load()
      } else {
        toast.error(data.error || "Couldn't void the posting. Try again.")
      }
    } catch {
      toast.error("Couldn't void the posting. Try again.")
    } finally {
      setVoiding(false)
    }
  }

  const empty = rows.length === 0 && postings.length === 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Business date</Label>
          <DatePicker value={date} onChange={setPicked} className="w-auto" />
        </div>
        {date && <Button variant="ghost" size="sm" onClick={() => setPicked("")}>Show all dates</Button>}
        {picked !== null && picked !== businessDate && businessDate && (
          <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>Back to {fmtDay(businessDate)}</Button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : empty ? (
        <EmptyState icon={Receipt} title={date ? "Nothing posted on this date" : "Nothing posted yet"} className="py-10" />
      ) : (
        <>
          {postings.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Room postings</h3>
              <div className="divide-y rounded-lg border">
                {postings.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className={`truncate font-medium ${p.isVoid ? "text-muted-foreground line-through" : "text-foreground"}`}>
                        {p.description}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Room {p.room}
                        {p.guest ? ` · ${p.guest}` : ""} · Folio #{p.folioNumber}
                        {p.outletName ? ` · ${p.outletName}` : ""}
                        {p.checkNumber ? ` · ${p.checkNumber}` : ""} · {fmtDay(p.date)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-4">
                      <p className={`font-semibold ${p.isVoid ? "text-muted-foreground line-through" : "text-foreground"}`}>${p.total.toFixed(2)}</p>
                      {p.isVoid && <Badge variant="outline" className="border-destructive/40 text-destructive">Voided</Badge>}
                      {p.reservationId && (
                        <Link
                          href={`/e/${slug}/dashboard/reservations/${p.reservationId}`}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          Open folio
                        </Link>
                      )}
                      {!p.isVoid && !p.folioClosed && (
                        <Button size="sm" variant="outline" onClick={() => { setVoidTarget(p); setVoidReason("") }}>Void</Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {rows.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Walk-in bills</h3>
              <div className="divide-y rounded-lg border">
                {rows.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {r.walkInGuestName || "Walk-in"}
                        {r.outletCheckNumber && <span className="ml-2 font-mono text-xs text-primary">{r.outletCheckNumber}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.outletName ? `${r.outletName} · ` : ""}
                        {r.taxInvoiceNumber ? `${r.taxInvoiceNumber} · ` : ""}
                        {fmtDay(r.closedBusinessDate)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-4">
                      <div className="text-right">
                        <p className="font-semibold text-foreground">${r.charges.toFixed(2)}</p>
                        {Math.abs(r.balance) > 0.01 && <p className="text-xs text-destructive">Balance ${r.balance.toFixed(2)}</p>}
                      </div>
                      {!r.isClosed && <Badge variant="outline" className="border-warning/40 text-warning">Open</Badge>}
                      {r.reopenable && <Badge variant="outline" className="border-success/40 text-success">Same day</Badge>}
                      <Button size="sm" variant="outline" onClick={() => onOpen(r.id)}>Open</Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <Dialog open={!!voidTarget} onOpenChange={(open) => { if (!open) setVoidTarget(null) }}>
        <DialogContent size="sm">
          <form onSubmit={handleVoid} className="contents">
            <DialogHeader>
              <DialogTitle>Void posting</DialogTitle>
              <DialogDescription>
                {voidTarget ? `${voidTarget.description} · Room ${voidTarget.room} · $${voidTarget.total.toFixed(2)}. The posting stays on the folio, marked void.` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label>Reason</Label>
              <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Why is this being voided?" autoFocus />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setVoidTarget(null)}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={!voidReason.trim() || voiding}>{voiding ? "Voiding…" : "Void posting"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
