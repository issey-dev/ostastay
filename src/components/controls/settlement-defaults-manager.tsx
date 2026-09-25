"use client"

import { useEffect, useState } from "react"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Skeleton } from "@/components/ui/skeleton"
import { SectionSaveFooter } from "@/components/controls/save-status"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"

type PaymentMethod = { id: string; name: string; type: string; isActive: boolean }

// Split out of the old combined "Posting & Settlement Defaults" card when charge-code
// configuration moved to its own Cashiering section: this half selects a Payment Method,
// so it belongs with Payment Methods under Finance. The charge-code half is
// PostingDefaultsManager (Controls > Cashiering).
export function SettlementDefaultsManager({ propertyId }: { propertyId: string }) {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [cityLedgerId, setCityLedgerId] = useState("")
  // The value last loaded/saved — the footer's Save stays off until the pick differs.
  const [savedId, setSavedId] = useState("")
  const [justSaved, setJustSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch(`/api/payment-methods?propertyId=${propertyId}`).then(r => r.json()),
      fetch(`/api/properties/${propertyId}/settings`).then(r => r.json()),
    ])
      .then(([pm, settings]) => {
        if (Array.isArray(pm)) setPaymentMethods(pm)
        setCityLedgerId(settings?.cityLedgerPaymentMethodId || "")
        setSavedId(settings?.cityLedgerPaymentMethodId || "")
      })
      .finally(() => setLoading(false))
  }, [propertyId])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch(`/api/properties/${propertyId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cityLedgerPaymentMethodId: cityLedgerId || "" }),
      })
      if (res.ok) {
        setSavedId(cityLedgerId)
        setJustSaved(true)
      } else {
        toast.error(await apiError(res, "Couldn't save the settlement default. Try again."))
      }
    } catch {
      toast.error("Couldn't save the settlement default. Try again.")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Skeleton className="h-10 w-full" />

  const cityLedgerMethods = paymentMethods.filter(pm => pm.type === "CITY_LEDGER")
  const status = cityLedgerId !== savedId ? "dirty" : justSaved ? "saved" : "idle"

  return (
    <form onSubmit={handleSave} className="space-y-5 max-w-xl">
      <div className="space-y-2">
        <Label>City Ledger settlement method</Label>
        <SearchableSelect
          value={cityLedgerId}
          onChange={(v) => { setCityLedgerId(v); setJustSaved(false) }}
          placeholder="Select a City Ledger payment method..."
          options={[
            { value: "", label: "None" },
            ...cityLedgerMethods.map(pm => ({ label: pm.name, value: pm.id })),
          ]}
        />
        <p className="text-xs text-muted-foreground">
          The payment method used to settle a City Ledger folio when it transfers to a debtor
          account at checkout. Must be a CITY_LEDGER-type Payment Method (add one above).
        </p>
      </div>

      <SectionSaveFooter status={status} saving={saving} />
    </form>
  )
}
