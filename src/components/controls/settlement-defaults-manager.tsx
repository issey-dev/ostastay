"use client"

import { useEffect, useState } from "react"
import { Save } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Skeleton } from "@/components/ui/skeleton"

type PaymentMethod = { id: string; name: string; type: string; isActive: boolean }

// Split out of the old combined "Posting & Settlement Defaults" card when charge-code
// configuration moved to its own Cashiering section: this half selects a Payment Method,
// so it belongs with Payment Methods under Finance. The charge-code half is
// PostingDefaultsManager (Controls > Cashiering).
export function SettlementDefaultsManager() {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [cityLedgerId, setCityLedgerId] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)

  useEffect(() => {
    Promise.all([
      fetch("/api/payment-methods").then(r => r.json()),
      fetch("/api/tenant-settings").then(r => r.json()),
    ])
      .then(([pm, settings]) => {
        if (Array.isArray(pm)) setPaymentMethods(pm)
        setCityLedgerId(settings?.cityLedgerPaymentMethodId || "")
      })
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch("/api/tenant-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cityLedgerPaymentMethodId: cityLedgerId || "" }),
      })
      if (res.ok) {
        setMessage({ text: "Settlement default saved." })
      } else {
        const body = await res.json().catch(() => null)
        setMessage({ text: body?.error || "Failed to save.", error: true })
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Skeleton className="h-10 w-full" />

  const cityLedgerMethods = paymentMethods.filter(pm => pm.type === "CITY_LEDGER")

  return (
    <div className="space-y-5 max-w-xl">
      <div className="space-y-2">
        <Label>City Ledger Settlement Method</Label>
        <SearchableSelect
          value={cityLedgerId}
          onChange={setCityLedgerId}
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

      {message && (
        <p className={`text-sm ${message.error ? "text-destructive" : "text-success"}`}>{message.text}</p>
      )}

      <Button onClick={handleSave} disabled={saving} className="shadow-sm">
        <Save className="w-4 h-4 mr-2" /> {saving ? "Saving..." : "Save Default"}
      </Button>
    </div>
  )
}
