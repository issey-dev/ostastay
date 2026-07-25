"use client"

import { useEffect, useState } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export type InHousePayment = { settleNow: boolean; paymentMethodId: string }
type PaymentMethod = { id: string; name: string; isActive?: boolean }

// For an in-house booking (Spa / Excursions) the charge always posts to the guest's
// room folio. This lets staff optionally SETTLE it in the same action — the booking
// route posts the charge AND records a payment of the same amount, so the item nets to
// zero on the folio ("charge & pay now") instead of riding on the room bill to checkout.
export function InHousePaymentChoice({
  value,
  onChange,
  amount,
  currency,
}: {
  value: InHousePayment
  onChange: (v: InHousePayment) => void
  amount?: number | null
  currency?: string
}) {
  const [methods, setMethods] = useState<PaymentMethod[]>([])

  useEffect(() => {
    fetch(`/api/payment-methods`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setMethods(d.filter((m: PaymentMethod) => m.isActive !== false)) })
      .catch(() => {})
  }, [])

  const money = amount != null ? `${currency ? `${currency} ` : ""}${amount.toFixed(2)}` : null

  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-3">
      <Label className="text-xs text-muted-foreground">Payment</Label>
      <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium w-fit">
        <button
          type="button"
          className={`px-3 py-1.5 ${!value.settleNow ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
          onClick={() => onChange({ ...value, settleNow: false })}
        >
          Charge to room
        </button>
        <button
          type="button"
          className={`px-3 py-1.5 ${value.settleNow ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
          onClick={() => onChange({ ...value, settleNow: true })}
        >
          Charge &amp; pay now
        </button>
      </div>

      {value.settleNow ? (
        <div className="space-y-2">
          <Select value={value.paymentMethodId} onValueChange={(v) => onChange({ ...value, paymentMethodId: v ?? "" })}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Payment method...">
                {methods.find((m) => m.id === value.paymentMethodId)?.name ?? "Payment method..."}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {methods.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Posts{money ? ` ${money}` : ""} to the room folio and settles it immediately — the item is paid, not carried to checkout.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Charge rides on the room bill and is settled at checkout.</p>
      )}
    </div>
  )
}
