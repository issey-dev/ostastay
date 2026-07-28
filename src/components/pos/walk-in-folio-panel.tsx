"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { FolioPrintDialog } from "@/components/front-office/folio-print-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Printer, CheckCircle2, Ban, RotateCcw } from "@/components/icons"

type WalkInFolioPanelProps = {
  folioId: string | null
  isOpen: boolean
  onClose: () => void
  onClosed?: () => void
}

// The walk-in (Fast Post) bill, shown as a modal. A walk-in has no reservation, no
// payee/sharer, no multi-folio structure — one running bill: charges (posted from the
// Fast Post form), take a payment, void the whole bill, print a Tax Invoice, and close
// out. A closed bill is read-only but can be REOPENED while it's still the same business
// day (the server enforces that).
export function WalkInFolioPanel({ folioId, isOpen, onClose, onClosed }: WalkInFolioPanelProps) {
  const { slug } = useParams<{ slug: string }>()
  const [folio, setFolio] = useState<any>(null)
  const [paymentMethods, setPaymentMethods] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [paymentForm, setPaymentForm] = useState({ paymentMethodId: "", amount: "", referenceNumber: "" })
  const [feedback, setFeedback] = useState<{ message: string; type: "success" | "error" } | null>(null)
  // Folio the print-style picker is open for (null = closed).
  const [printFolioId, setPrintFolioId] = useState<string | null>(null)

  const fetchFolio = useCallback(() => {
    if (!folioId) return
    setLoading(true)
    fetch(`/api/folios/${folioId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setFolio(data) })
      .finally(() => setLoading(false))
  }, [folioId])

  useEffect(() => {
    if (isOpen && folioId) {
      setFolio(null)
      setFeedback(null)
      fetchFolio()
      fetch(`/api/payment-methods`)
        .then((res) => res.json())
        .then((data) => { if (Array.isArray(data)) setPaymentMethods(data.filter((m: any) => m.isActive !== false)) })
        .catch(console.error)
    }
  }, [isOpen, folioId, fetchFolio])

  const activeCharges = folio ? folio.lineItems.filter((i: any) => !i.isVoid) : []
  const balance = folio
    ? activeCharges.reduce((sum: number, i: any) => sum + i.amount + (i.serviceChargeAmount || 0) + i.taxAmount, 0) -
      folio.payments.reduce((sum: number, p: any) => sum + (p.isRefund ? -p.amount : p.amount), 0)
    : 0
  const closed = !!folio?.isClosed

  const flash = (message: string, type: "success" | "error") => {
    setFeedback({ message, type })
    setTimeout(() => setFeedback(null), 4000)
  }

  const handlePostPayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!folioId) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/folios/${folioId}/payments`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(paymentForm),
      })
      if (res.ok) {
        setPaymentForm({ paymentMethodId: "", amount: "", referenceNumber: "" })
        fetchFolio()
        flash("Payment posted.", "success")
      } else {
        flash((await res.json()).error || "Failed to post payment.", "error")
      }
    } catch {
      flash("An unexpected error occurred.", "error")
    } finally {
      setSubmitting(false)
    }
  }

  const handleVoidBill = async () => {
    if (!folioId) return
    const reason = window.prompt("Void the entire bill? This cancels the sale (charges are kept, flagged void).\n\nReason:")
    if (reason === null) return
    if (!reason.trim()) { flash("A reason is required to void the bill.", "error"); return }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/folios/${folioId}/void-bill`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: reason.trim() }),
      })
      if (res.ok) { fetchFolio(); flash("Bill voided.", "success") }
      else flash((await res.json()).error || "Failed to void the bill.", "error")
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = async () => {
    if (!folioId) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/folios/${folioId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isClosed: true }),
      })
      if (res.ok) { fetchFolio(); onClosed?.() }
      else flash((await res.json()).error || "Failed to close the bill.", "error")
    } finally {
      setSubmitting(false)
    }
  }

  const handleReopen = async () => {
    if (!folioId) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/folios/${folioId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isClosed: false }),
      })
      if (res.ok) { fetchFolio(); flash("Bill reopened for adjustments.", "success") }
      else flash((await res.json()).error || "This bill can no longer be reopened.", "error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {folio?.walkInGuestName || "Walk-in Bill"}
            {closed && <Badge variant="outline" className="text-muted-foreground">Closed</Badge>}
          </DialogTitle>
        </DialogHeader>

        {loading || !folio ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-5">
            {/* Balance + primary actions */}
            <div className="rounded-xl border bg-muted/40 p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Balance Due</p>
                <p className={`text-3xl font-bold ${balance > 0.005 ? "text-destructive" : balance < -0.005 ? "text-success" : "text-foreground"}`}>
                  ${balance.toFixed(2)}
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setPrintFolioId(folioId)}>
                  <Printer className="w-4 h-4 mr-2" /> Tax Invoice
                </Button>
                {closed ? (
                  <Button size="sm" variant="outline" onClick={handleReopen} disabled={submitting}>
                    <RotateCcw className="w-4 h-4 mr-2" /> Reopen
                  </Button>
                ) : (
                  <>
                    {activeCharges.length > 0 && (
                      <Button size="sm" variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive-muted hover:text-destructive" onClick={handleVoidBill} disabled={submitting}>
                        <Ban className="w-4 h-4 mr-2" /> Void Bill
                      </Button>
                    )}
                    <Button size="sm" onClick={handleClose} disabled={submitting}>
                      <CheckCircle2 className="w-4 h-4 mr-2" /> Close Bill
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Charges */}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Charges</h3>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {folio.lineItems.length === 0 && (
                    <TableRow><TableCell colSpan={2} className="text-center text-sm text-muted-foreground">No charges yet.</TableCell></TableRow>
                  )}
                  {folio.lineItems.map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell className={item.isVoid ? "line-through text-muted-foreground" : ""}>{item.description}</TableCell>
                      <TableCell className={`text-right ${item.isVoid ? "line-through text-muted-foreground" : ""}`}>${(item.amount + (item.serviceChargeAmount || 0) + item.taxAmount).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Payments */}
            {folio.payments.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Payments</h3>
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {folio.payments.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell>{p.paymentMethod?.name}</TableCell>
                        <TableCell className="text-right font-medium text-success">${p.amount.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Take payment (open bills only) */}
            {!closed && (
              <form onSubmit={handlePostPayment} className="grid gap-3 border-t pt-4">
                <h3 className="text-sm font-semibold">Take Payment</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Method *</Label>
                    <Select required value={paymentForm.paymentMethodId} onValueChange={(v) => setPaymentForm((p) => ({ ...p, paymentMethodId: v ?? "" }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select method">{paymentMethods.find((m) => m.id === paymentForm.paymentMethodId)?.name}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>{paymentMethods.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Amount *</Label>
                    <Input required type="number" step="0.01" min="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm((p) => ({ ...p, amount: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Reference No. (optional)</Label>
                  <Input value={paymentForm.referenceNumber} onChange={(e) => setPaymentForm((p) => ({ ...p, referenceNumber: e.target.value }))} />
                </div>
                <Button type="submit" className="bg-success hover:bg-success/90" disabled={submitting || !paymentForm.paymentMethodId || !paymentForm.amount}>
                  {submitting ? "Posting…" : "Post Payment"}
                </Button>
              </form>
            )}

            {feedback && (
              <div className={`rounded-lg p-3 text-sm font-medium ${feedback.type === "success" ? "bg-success-muted text-success" : "bg-destructive-muted text-destructive"}`}>
                {feedback.message}
              </div>
            )}
          </div>
        )}
      </DialogContent>

      {/* Folio style picker — asked before the bill is generated. */}
      {printFolioId && (
        <FolioPrintDialog
          open
          onOpenChange={(o) => { if (!o) setPrintFolioId(null) }}
          folioId={printFolioId}
          documentType="tax"
          slug={slug}
        />
      )}
    </Dialog>
  )
}

