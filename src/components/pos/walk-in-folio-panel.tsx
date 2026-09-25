"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MobileActions, type MobileAction } from "@/components/ui/mobile"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
import { Button } from "@/components/ui/button"
import { FolioPrintDialog } from "@/components/front-office/folio-print-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StatusBadge } from "@/components/ui/status-badge"
import { EmptyState } from "@/components/ui/empty-state"
import { InlineLoading } from "@/components/ui/inline-loading"
import { SubmitButton } from "@/components/ui/submit-button"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Printer, CheckCircle2, Ban, RotateCcw } from "@/components/icons"
import { useProperty } from "@/components/providers/property-provider"
import { useReasonPrompt } from "@/components/providers/confirm-provider"

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
  const askReason = useReasonPrompt()
  // Payment methods are per property — the property this walk-in bill belongs to.
  const { currentProperty } = useProperty()
  const { slug } = useParams<{ slug: string }>()
  const [folio, setFolio] = useState<any>(null)
  const [paymentMethods, setPaymentMethods] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [paymentForm, setPaymentForm] = useState({ paymentMethodId: "", amount: "", referenceNumber: "" })
  // Same rule as the guest folio: the amount is the balance until the cashier edits it.
  const [paymentAmountTouched, setPaymentAmountTouched] = useState(false)
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
      setPaymentAmountTouched(false)
      fetchFolio()
      if (currentProperty) fetch(`/api/payment-methods?propertyId=${currentProperty.id}`)
        .then((res) => res.json())
        .then((data) => { if (Array.isArray(data)) setPaymentMethods(data.filter((m: any) => m.isActive !== false)) })
        .catch(console.error)
    }
  }, [isOpen, folioId, fetchFolio, currentProperty])

  const activeCharges = folio ? folio.lineItems.filter((i: any) => !i.isVoid) : []
  const balance = folio
    ? activeCharges.reduce((sum: number, i: any) => sum + i.amount + (i.serviceChargeAmount || 0) + i.taxAmount, 0) -
      folio.payments.reduce((sum: number, p: any) => sum + (p.isRefund ? -p.amount : p.amount), 0)
    : 0
  const closed = !!folio?.isClosed
  const paymentAmount = paymentAmountTouched ? paymentForm.amount : balance > 0.005 ? balance.toFixed(2) : ""

  const handlePostPayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!folioId) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/folios/${folioId}/payments`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...paymentForm, amount: paymentAmount }),
      })
      if (res.ok) {
        setPaymentForm({ paymentMethodId: "", amount: "", referenceNumber: "" })
        setPaymentAmountTouched(false)
        fetchFolio()
        toast.success("Payment posted")
      } else {
        toast.error(await apiError(res, "Couldn't post the payment. Try again."))
      }
    } catch {
      toast.error("Couldn't post the payment. Try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const handleVoidBill = async () => {
    if (!folioId) return
    const reason = await askReason({
      title: "Void this bill?",
      description: "This cancels the sale. The charges are kept, marked void.",
      reasonLabel: "Reason",
      destructive: true,
      confirmLabel: "Void bill",
    })
    if (reason === null || !reason.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/folios/${folioId}/void-bill`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: reason.trim() }),
      })
      if (res.ok) { fetchFolio(); toast.success("Bill voided") }
      else toast.error(await apiError(res, "Couldn't void the bill. Try again."))
    } catch {
      toast.error("Couldn't void the bill. Try again.")
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
      if (res.ok) { fetchFolio(); toast.success("Bill closed"); onClosed?.() }
      else toast.error(await apiError(res, "Couldn't close the bill. Try again."))
    } catch {
      toast.error("Couldn't close the bill. Try again.")
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
      if (res.ok) { fetchFolio(); toast.success("Bill reopened for adjustments") }
      else toast.error(await apiError(res, "This bill can no longer be reopened."))
    } catch {
      toast.error("Couldn't reopen the bill. Try again.")
    } finally {
      setSubmitting(false)
    }
  }

  // Phones: the bill's actions live in a pinned footer — one primary (take payment while
  // money is owed, otherwise close the bill) and the rest under More. Print is desktop-only.
  const phoneMore: MobileAction[] = closed
    ? [{ label: "Reopen bill", icon: RotateCcw, disabled: submitting, onSelect: handleReopen }]
    : [
        ...(balance > 0.005 ? [{ label: "Close bill", icon: CheckCircle2, disabled: submitting, onSelect: handleClose }] : []),
        ...(activeCharges.length > 0 ? [{ label: "Void bill", icon: Ban, disabled: submitting, destructive: true, onSelect: handleVoidBill }] : []),
      ]
  const phonePrimary = closed ? undefined : balance > 0.005 ? (
    <SubmitButton form="walkin-payment-form" className="bg-success hover:bg-success/90" pending={submitting} pendingLabel="Posting…" disabled={!paymentForm.paymentMethodId || !paymentAmount}>
      {`Take payment $${balance.toFixed(2)}`}
    </SubmitButton>
  ) : (
    <Button onClick={handleClose} disabled={submitting}>
      <CheckCircle2 className="w-4 h-4 mr-2" /> Close bill
    </Button>
  )

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {folio?.walkInGuestName || "Walk-in bill"}
            {closed && <StatusBadge label="Closed" tone="neutral" />}
          </DialogTitle>
        </DialogHeader>

        {loading || !folio ? (
          <InlineLoading lines={5} label="Loading the bill" />
        ) : (
          <div className="space-y-5">
            {/* Balance + primary actions */}
            <div className="rounded-xl border bg-muted/40 p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Balance due</p>
                <p className={`text-3xl font-bold ${balance > 0.005 ? "text-destructive" : balance < -0.005 ? "text-success" : "text-foreground"}`}>
                  ${balance.toFixed(2)}
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2 max-md:hidden">
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
                        <Ban className="w-4 h-4 mr-2" /> Void bill
                      </Button>
                    )}
                    <Button size="sm" onClick={handleClose} disabled={submitting}>
                      <CheckCircle2 className="w-4 h-4 mr-2" /> Close bill
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Charges */}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Charges</h3>
              {/* Phones: one card per charge; the table takes over at md. */}
              <MobileCardList empty={<EmptyState size="inline" title="No charges yet" />}>
                {folio.lineItems.map((item: any) => (
                  <MobileCard
                    key={item.id}
                    tone={item.isVoid ? "muted" : undefined}
                    title={<span className={item.isVoid ? "line-through text-muted-foreground" : ""}>{item.description}</span>}
                    badge={
                      <span className={`font-semibold tabular-nums ${item.isVoid ? "line-through text-muted-foreground" : ""}`}>
                        ${(item.amount + (item.serviceChargeAmount || 0) + item.taxAmount).toFixed(2)}
                      </span>
                    }
                    subtitle={item.isVoid ? "Void" : undefined}
                  />
                ))}
              </MobileCardList>
              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {folio.lineItems.length === 0 && (
                    <TableRow><TableCell colSpan={2}><EmptyState size="inline" className="justify-center" title="No charges yet" /></TableCell></TableRow>
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
                <MobileCardList>
                  {folio.payments.map((p: any) => (
                    <MobileCard
                      key={p.id}
                      title={p.paymentMethod?.name}
                      badge={<span className="font-semibold tabular-nums text-success">${p.amount.toFixed(2)}</span>}
                    />
                  ))}
                </MobileCardList>
                <Table className="hidden md:table">
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
              <form id="walkin-payment-form" onSubmit={handlePostPayment} className="grid gap-3 border-t pt-4">
                <h3 className="text-sm font-semibold">Take payment</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    <Input required type="number" inputMode="decimal" step="0.01" min="0.01" value={paymentAmount} onChange={(e) => { setPaymentAmountTouched(true); setPaymentForm((p) => ({ ...p, amount: e.target.value })) }} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Reference no. (optional)</Label>
                  <Input value={paymentForm.referenceNumber} onChange={(e) => setPaymentForm((p) => ({ ...p, referenceNumber: e.target.value }))} />
                </div>
                <SubmitButton className="bg-success hover:bg-success/90 max-md:hidden" pending={submitting} pendingLabel="Posting…" disabled={!paymentForm.paymentMethodId || !paymentAmount}>
                  Post payment
                </SubmitButton>
              </form>
            )}

          </div>
        )}
        {folio && !loading && (
          <DialogFooter className="md:hidden">
            <MobileActions className="w-full" primary={phonePrimary} more={phoneMore} />
          </DialogFooter>
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

