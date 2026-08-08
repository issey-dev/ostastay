"use client"

import { useEffect, useState, useCallback, use } from "react"
import Link from "next/link"
import { ArrowLeft, Printer, Loader2, AlertTriangle, CreditCard } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useProperty } from "@/components/providers/property-provider"
import { InfoHint } from "@/components/ui/info-hint"

const money = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" })
const dateStr = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—")

type PaymentMethod = { id: string; name: string }
type Invoice = {
  folioId: string
  confirmationNo: string | null
  guestName: string
  checkInDate: string | null
  checkOutDate: string | null
  total: number
  balance: number
  isOpen: boolean
}

export default function DebtorAccountDetailPage({ params }: { params: Promise<{ profileId: string; slug: string }> }) {
  const { profileId, slug } = use(params)
  const { currentProperty } = useProperty()
  const propertyId = currentProperty?.id ?? ""

  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])

  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null)
  const [payForm, setPayForm] = useState({ paymentMethodId: "", amount: "", referenceNumber: "" })
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)

  const fetchAccount = useCallback(() => {
    if (!propertyId) return
    setLoading(true)
    fetch(`/api/debtors/accounts/${profileId}?propertyId=${propertyId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [propertyId, profileId])

  useEffect(() => { fetchAccount() }, [fetchAccount])

  useEffect(() => {
    if (!propertyId) return
    fetch(`/api/payment-methods?propertyId=${propertyId}`)
      .then((res) => res.json())
      .then((d) => { if (Array.isArray(d)) setPaymentMethods(d) })
  }, [propertyId])

  const openPayDialog = (invoice: Invoice) => {
    setPayingInvoice(invoice)
    setPayForm({ paymentMethodId: "", amount: invoice.balance.toFixed(2), referenceNumber: "" })
    setPayError(null)
  }

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!payingInvoice || !payForm.paymentMethodId || !payForm.amount) return
    setPaying(true)
    setPayError(null)
    try {
      const res = await fetch(`/api/folios/${payingInvoice.folioId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethodId: payForm.paymentMethodId,
          amount: parseFloat(payForm.amount),
          referenceNumber: payForm.referenceNumber || undefined,
        }),
      })
      if (res.ok) {
        setPayingInvoice(null)
        fetchAccount()
      } else {
        const body = await res.json()
        setPayError(body.error || "Failed to record payment.")
      }
    } catch {
      setPayError("An unexpected error occurred.")
    } finally {
      setPaying(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col justify-center items-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }
  if (!data) {
    return <div className="p-8 text-center text-destructive">Credit account not found.</div>
  }

  const { profile, invoices, balance, aging } = data as { profile: any; invoices: Invoice[]; balance: number; aging: Record<string, number> }
  const overLimit = profile.creditLimit != null && balance > profile.creditLimit
  const accountName = profile.companyName || [profile.firstName, profile.lastName].filter(Boolean).join(" ")

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Link href={`/e/${slug}/dashboard/debtors`} className="shrink-0">
            <Button variant="ghost" size="icon" aria-label="Back"><ArrowLeft className="w-4 h-4" /></Button>
          </Link>
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-tight flex flex-wrap items-center gap-2 sm:text-2xl">
              {accountName}
              <Badge variant="outline">{profile.profileType === "TRAVEL_AGENT" ? "Travel Agent" : "Company"}</Badge>
            </h2>
            <p className="text-sm text-muted-foreground">
              {profile.arNumber ? `AR Number: ${profile.arNumber}` : "No AR number set"}
              {profile.creditLimit != null && ` · Credit Limit: ${money(profile.creditLimit)}`}
            </p>
          </div>
        </div>
        <Link href={`/e/${slug}/dashboard/debtors/${profileId}/statement`} target="_blank" className="sm:shrink-0">
          <Button variant="outline" className="w-full sm:w-auto"><Printer className="w-4 h-4 mr-2" /> Statement</Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card className="col-span-2 md:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground font-medium">Outstanding Balance</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold flex items-center gap-2 ${overLimit ? "text-destructive" : ""}`}>
              {overLimit && <AlertTriangle className="w-5 h-5" />}
              {money(balance)}
            </div>
            {overLimit && <p className="text-xs text-destructive mt-1">Over credit limit</p>}
          </CardContent>
        </Card>
        {(["current", "1-30", "31-60", "61-90", "90+"] as const).map((bucket) => (
          <Card key={bucket}>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-medium uppercase">{bucket === "current" ? "Current" : `${bucket} days`}</CardTitle></CardHeader>
            <CardContent><div className="text-lg font-semibold">{money(aging[bucket])}</div></CardContent>
          </Card>
        ))}
      </div>

      <div>
        <h3 className="flex items-center gap-2 font-semibold text-lg mb-3">
            Invoices
            <InfoHint label="Invoices">One row per stay billed to this account — invoices appear here only once the guest has checked out.</InfoHint>
          </h3>
        {/* Mobile: stacked cards instead of a horizontally-scrolled table */}
        <div className="md:hidden space-y-3">
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No invoices yet.</p>
          ) : (
            invoices.map((inv) => (
              <div key={inv.folioId} className="rounded-md border border-border bg-card p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{inv.guestName}</p>
                    <p className="text-xs text-muted-foreground">{inv.confirmationNo || "—"}</p>
                  </div>
                  <Badge variant={inv.isOpen ? "destructive" : "outline"} className="shrink-0">{inv.isOpen ? "Open" : "Paid"}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{dateStr(inv.checkInDate)} – {dateStr(inv.checkOutDate)}</p>
                <div className="flex items-center justify-between text-sm pt-2 border-t border-border">
                  <span className="text-muted-foreground">Total {money(inv.total)}</span>
                  <span className={`font-semibold ${inv.isOpen ? "text-destructive" : "text-foreground"}`}>{money(inv.balance)}</span>
                </div>
                {inv.isOpen && (
                  <Button variant="outline" size="sm" className="w-full" onClick={() => openPayDialog(inv)}>
                    <CreditCard className="w-3.5 h-3.5 mr-1.5" /> Record Payment
                  </Button>
                )}
              </div>
            ))
          )}
        </div>

        {/* Tablet/desktop: full table */}
        <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Guest</TableHead>
                <TableHead>Conf. #</TableHead>
                <TableHead>Stay</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No invoices yet.</TableCell></TableRow>
              ) : (
                invoices.map((inv) => (
                  <TableRow key={inv.folioId}>
                    <TableCell className="font-medium">{inv.guestName}</TableCell>
                    <TableCell className="text-muted-foreground">{inv.confirmationNo || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{dateStr(inv.checkInDate)} – {dateStr(inv.checkOutDate)}</TableCell>
                    <TableCell className="text-right">{money(inv.total)}</TableCell>
                    <TableCell className={`text-right font-medium ${inv.isOpen ? "text-destructive" : ""}`}>{money(inv.balance)}</TableCell>
                    <TableCell>
                      <Badge variant={inv.isOpen ? "destructive" : "outline"}>{inv.isOpen ? "Open" : "Paid"}</Badge>
                    </TableCell>
                    <TableCell>
                      {inv.isOpen && (
                        <Button variant="outline" size="sm" onClick={() => openPayDialog(inv)}>
                          <CreditCard className="w-3.5 h-3.5 mr-1.5" /> Record Payment
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={!!payingInvoice} onOpenChange={(open) => { if (!open) setPayingInvoice(null) }}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              {payingInvoice && `Against ${payingInvoice.guestName}'s invoice (${payingInvoice.confirmationNo || "—"}), balance ${money(payingInvoice.balance)}.`}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRecordPayment} className="space-y-3">
            <div className="grid gap-2">
              <Label>Payment Method</Label>
              <Select value={payForm.paymentMethodId} onValueChange={(v) => setPayForm((p) => ({ ...p, paymentMethodId: v ?? "" }))}>
                <SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((pm) => <SelectItem key={pm.id} value={pm.id}>{pm.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Amount</Label>
              <Input type="number" step="0.01" min="0.01" value={payForm.amount} onChange={(e) => setPayForm((p) => ({ ...p, amount: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label>Reference (optional)</Label>
              <Input value={payForm.referenceNumber} onChange={(e) => setPayForm((p) => ({ ...p, referenceNumber: e.target.value }))} placeholder="e.g. wire transfer #" />
            </div>
            {payError && <p className="text-xs font-medium text-destructive">{payError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPayingInvoice(null)}>Cancel</Button>
              <Button type="submit" disabled={paying || !payForm.paymentMethodId || !payForm.amount}>
                {paying ? "Recording..." : "Record Payment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
