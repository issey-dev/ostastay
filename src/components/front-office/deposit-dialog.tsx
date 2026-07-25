"use client"

import { useEffect, useState } from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Loader2 } from "@/components/icons"
import { toast } from "@/lib/toast"

type DepositDialogProps = {
  reservationId: string | null
  confirmationNo?: string
  guestName?: string
  isOpen: boolean
  onClose: () => void
  onSaved: (message: string) => void
  // Pre-select a purpose and amount (e.g. the "collect the cancellation fee" prompt).
  defaultPurpose?: string
  defaultAmount?: number
}

const PURPOSE_OPTIONS = [
  { value: "DEPOSIT", label: "Deposit" },
  { value: "PRE_ARRIVAL_FEE", label: "Pre-arrival fee" },
  { value: "CANCELLATION_FEE", label: "Cancellation fee" },
  { value: "NO_SHOW_FEE", label: "No-show fee" },
]
const PURPOSE_LABEL: Record<string, string> = Object.fromEntries(PURPOSE_OPTIONS.map((o) => [o.value, o.label]))

// APP STANDARD 001: Zod + React Hook Form with inline, real-time validation. Amount is
// kept as a string field (native number input) and validated to a positive number here,
// replacing the old parseFloat-after-submit guard.
const depositSchema = z.object({
  purpose: z.string().min(1, "Select a type."),
  paymentMethodId: z.string().min(1, "Select a payment method."),
  amount: z
    .string()
    .refine((v) => v.trim() !== "", "Enter an amount.")
    .refine((v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 }, "Enter a positive amount."),
  referenceNumber: z.string().optional(),
})
type DepositFormValues = z.infer<typeof depositSchema>

// Collect pre-arrival money on a RESERVED booking — a plain deposit or a typed fee
// (pre-arrival / cancellation / no-show). Posts to the deposit route, which creates
// the folio if the stay hasn't opened one yet, so the money is already on the
// billing window at check-in. Fees are collected here, never through billing.
export function DepositDialog({ reservationId, confirmationNo, guestName, isOpen, onClose, onSaved, defaultPurpose, defaultAmount }: DepositDialogProps) {
  const [paymentMethods, setPaymentMethods] = useState<{ id: string; name: string }[]>([])

  const form = useForm<DepositFormValues>({
    resolver: zodResolver(depositSchema),
    mode: "onChange",
    defaultValues: { purpose: "DEPOSIT", paymentMethodId: "", amount: "", referenceNumber: "" },
  })

  useEffect(() => {
    if (!isOpen) return
    form.reset({
      purpose: defaultPurpose ?? "DEPOSIT",
      paymentMethodId: "",
      amount: defaultAmount != null ? String(defaultAmount) : "",
      referenceNumber: "",
    })
    fetch(`/api/payment-methods`)
      .then((res) => res.json())
      .then((data) => { if (Array.isArray(data)) setPaymentMethods(data.filter((m: { isActive?: boolean }) => m.isActive !== false)) })
      .catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, defaultPurpose, defaultAmount])

  const purpose = form.watch("purpose")

  const onSubmit = async (values: DepositFormValues) => {
    if (!reservationId) return
    const parsedAmount = parseFloat(values.amount)
    try {
      const res = await fetch(`/api/reservations/${reservationId}/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethodId: values.paymentMethodId,
          amount: parsedAmount,
          referenceNumber: values.referenceNumber || null,
          purpose: values.purpose,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        onClose()
        onSaved(`$${parsedAmount.toFixed(2)} ${(PURPOSE_LABEL[values.purpose] ?? "payment").toLowerCase()} collected${confirmationNo ? ` on ${confirmationNo}` : ""}.`)
      } else {
        toast.error(data.error || "Failed to collect payment.")
      }
    } catch {
      toast.error("An unexpected error occurred.")
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Collect Deposit / Fee</DialogTitle>
          <DialogDescription>
            {guestName ? `${guestName} — ` : ""}{confirmationNo || ""}. Posts to the reservation&apos;s folio and carries onto
            the billing window at check-in. Pre-arrival, cancellation, and no-show fees are collected here — not through billing.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
            <FormField control={form.control} name="purpose" render={({ field }) => (
              <FormItem>
                <FormLabel>Type</FormLabel>
                <FormControl>
                  <SearchableSelect value={field.value} onChange={field.onChange} placeholder="Select type..." options={PURPOSE_OPTIONS} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="paymentMethodId" render={({ field }) => (
              <FormItem>
                <FormLabel>Payment Method</FormLabel>
                <FormControl>
                  <SearchableSelect value={field.value} onChange={field.onChange} placeholder="Select payment method..." options={paymentMethods.map((m) => ({ label: m.name, value: m.id }))} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="amount" render={({ field }) => (
              <FormItem>
                <FormLabel>Amount</FormLabel>
                <FormControl>
                  <Input type="number" min="0.01" step="0.01" placeholder="0.00" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="referenceNumber" render={({ field }) => (
              <FormItem>
                <FormLabel>Reference (optional)</FormLabel>
                <FormControl>
                  <Input placeholder="Card auth / transfer reference" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={form.formState.isSubmitting}>Cancel</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Collect {PURPOSE_LABEL[purpose] ?? "Payment"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
