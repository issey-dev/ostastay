"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Printer, CheckCircle2 } from "lucide-react"

type WalkInFolioPanelProps = {
  folioId: string | null
  isOpen: boolean
  onClose: () => void
  onClosed?: () => void
}

// A deliberately minimal counterpart to FolioPanel — a walk-in bill has no reservation,
// no payee/sharer concept, and no multi-folio structure, so this only ever needs to
// show one running bill: charges already posted via the main POS "Route Charge" form
// (any folio works there, walk-in or reservation-backed), plus take a payment and close
// out — a passerby's whole visit should be completable without leaving POS.
export function WalkInFolioPanel({ folioId, isOpen, onClose, onClosed }: WalkInFolioPanelProps) {
  const { slug } = useParams<{ slug: string }>()
  const [folio, setFolio] = useState<any>(null)
  const [paymentMethods, setPaymentMethods] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [paymentForm, setPaymentForm] = useState({ paymentMethodId: "", amount: "", referenceNumber: "" })
  const [feedback, setFeedback] = useState<{ message: string; type: "success" | "error" } | null>(null)

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
      fetchFolio()
      fetch(`/api/payment-methods`)
        .then((res) => res.json())
        .then((data) => { if (Array.isArray(data)) setPaymentMethods(data) })
        .catch(console.error)
    }
  }, [isOpen, folioId, fetchFolio])

  const balance = folio
    ? folio.lineItems.reduce((sum: number, i: any) => sum + (i.isVoid ? 0 : i.amount + (i.serviceChargeAmount || 0) + i.taxAmount), 0) -
      folio.payments.reduce((sum: number, p: any) => sum + (p.isRefund ? -p.amount : p.amount), 0)
    : 0

  const handlePostPayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!folioId) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/folios/${folioId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(paymentForm),
      })
      if (res.ok) {
        setPaymentForm({ paymentMethodId: "", amount: "", referenceNumber: "" })
        fetchFolio()
        setFeedback({ message: "Payment posted.", type: "success" })
      } else {
        const err = await res.json()
        setFeedback({ message: err.error || "Failed to post payment.", type: "error" })
      }
    } catch (err) {
      setFeedback({ message: "An unexpected error occurred.", type: "error" })
    } finally {
      setSubmitting(false)
      setTimeout(() => setFeedback(null), 4000)
    }
  }

  const handleClose = async () => {
    if (!folioId) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/folios/${folioId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isClosed: true }),
      })
      if (res.ok) {
        fetchFolio()
        onClosed?.()
      } else {
        const err = await res.json()
        setFeedback({ message: err.error || "Failed to close the bill.", type: "error" })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{folio?.walkInGuestName || "Walk-in Bill"}</SheetTitle>
        </SheetHeader>

        <div className="px-4 pb-6 space-y-6">
          {loading || !folio ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <>
              <div className="bg-card p-4 rounded-xl border shadow-sm flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Balance</p>
                  <p className={`text-3xl font-bold ${balance > 0 ? "text-destructive" : balance < 0 ? "text-success" : "text-foreground"}`}>
                    ${balance.toFixed(2)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => window.open(`/e/${slug}/dashboard/folios/${folioId}/print?type=tax`, "_blank")}>
                    <Printer className="w-4 h-4 mr-2" /> Tax Invoice
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => window.open(`/e/${slug}/dashboard/folios/${folioId}/print?type=proforma`, "_blank")}>
                    <Printer className="w-4 h-4 mr-2" /> Proforma Invoice
                  </Button>
                  {!folio.isClosed && (
                    <Button size="sm" onClick={handleClose} disabled={submitting}>
                      <CheckCircle2 className="w-4 h-4 mr-2" /> Close Bill
                    </Button>
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold text-foreground mb-2">Charges</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {folio.lineItems.length === 0 && (
                      <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground text-sm">No charges yet.</TableCell></TableRow>
                    )}
                    {folio.lineItems.map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell className={item.isVoid ? "line-through text-muted-foreground" : ""}>{item.description}</TableCell>
                        <TableCell className="text-right">${(item.amount + (item.serviceChargeAmount || 0) + item.taxAmount).toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div>
                <h3 className="text-sm font-bold text-foreground mb-2">Payments</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {folio.payments.length === 0 && (
                      <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground text-sm">No payments yet.</TableCell></TableRow>
                    )}
                    {folio.payments.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell>{p.paymentMethod?.name}</TableCell>
                        <TableCell className="text-right text-success font-medium">${p.amount.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {!folio.isClosed && (
                <form onSubmit={handlePostPayment} className="grid gap-4 border-t pt-4">
                  <h3 className="text-sm font-bold text-foreground">Take Payment</h3>
                  <div className="space-y-2">
                    <Label>Payment Method *</Label>
                    <Select required value={paymentForm.paymentMethodId} onValueChange={(v) => setPaymentForm((p) => ({ ...p, paymentMethodId: v ?? "" }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select Method">
                          {paymentMethods.find((m) => m.id === paymentForm.paymentMethodId)?.name}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {paymentMethods.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Amount *</Label>
                    <Input required type="number" step="0.01" min="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm((p) => ({ ...p, amount: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Reference No. (Optional)</Label>
                    <Input value={paymentForm.referenceNumber} onChange={(e) => setPaymentForm((p) => ({ ...p, referenceNumber: e.target.value }))} />
                  </div>
                  <Button type="submit" className="w-full bg-success hover:bg-success/90" disabled={submitting}>
                    {submitting ? "Posting..." : "Post Payment"}
                  </Button>
                </form>
              )}

              {feedback && (
                <div className={`p-3 rounded-lg text-sm font-medium ${feedback.type === "success" ? "bg-success-muted text-success" : "bg-destructive-muted text-destructive"}`}>
                  {feedback.message}
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
