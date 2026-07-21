"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Loader2 } from "lucide-react"

type DepositDialogProps = {
  reservationId: string | null
  confirmationNo?: string
  guestName?: string
  isOpen: boolean
  onClose: () => void
  onSaved: (message: string) => void
}

// Collect a pre-arrival deposit on a RESERVED booking. Posts to the dedicated
// deposit route, which creates the folio if the stay hasn't opened one yet —
// the money is then already on the billing window when the guest checks in.
export function DepositDialog({ reservationId, confirmationNo, guestName, isOpen, onClose, onSaved }: DepositDialogProps) {
  const [paymentMethods, setPaymentMethods] = useState<{ id: string; name: string }[]>([])
  const [paymentMethodId, setPaymentMethodId] = useState("")
  const [amount, setAmount] = useState("")
  const [referenceNumber, setReferenceNumber] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setAmount("")
      setReferenceNumber("")
      setError(null)
      fetch(`/api/payment-methods`)
        .then((res) => res.json())
        .then((data) => { if (Array.isArray(data)) setPaymentMethods(data.filter((m: any) => m.isActive !== false)) })
        .catch(console.error)
    }
  }, [isOpen])

  const handleSubmit = async () => {
    if (!reservationId) return
    const parsedAmount = parseFloat(amount)
    if (!paymentMethodId) { setError("Select a payment method."); return }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) { setError("Enter a positive amount."); return }

    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/reservations/${reservationId}/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethodId,
          amount: parsedAmount,
          referenceNumber: referenceNumber || null,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        onClose()
        onSaved(`$${parsedAmount.toFixed(2)} deposit collected${confirmationNo ? ` on ${confirmationNo}` : ""}.`)
      } else {
        setError(data.error || "Failed to collect deposit.")
      }
    } catch {
      setError("An unexpected error occurred.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Collect Deposit</DialogTitle>
          <DialogDescription>
            {guestName ? `${guestName} — ` : ""}{confirmationNo || ""}. The deposit posts to the reservation's folio and
            carries onto the billing window at check-in.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Payment Method</Label>
            <SearchableSelect
              value={paymentMethodId}
              onChange={(v: string) => setPaymentMethodId(v)}
              placeholder="Select payment method..."
              options={paymentMethods.map((m) => ({ label: m.name, value: m.id }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="deposit-amount">Amount</Label>
            <Input
              id="deposit-amount"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="deposit-ref">Reference (optional)</Label>
            <Input
              id="deposit-ref"
              placeholder="Card auth / transfer reference"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Collect Deposit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
