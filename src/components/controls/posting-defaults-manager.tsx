"use client"

import { useEffect, useState } from "react"
import { Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Skeleton } from "@/components/ui/skeleton"

type ChargeCode = { id: string; code: string; description: string; category: string }
type PaymentMethod = { id: string; name: string; type: string; isActive: boolean }

// Enterprise-wide posting & settlement defaults: which charge code a room charge posts
// against when a rate plan doesn't specify its own, and which payment method settles a
// City Ledger folio at checkout. See EnterpriseSettings.defaultAccommodationChargeCodeId
// / cityLedgerPaymentMethodId and src/app/api/tenant-settings/route.ts.
export function PostingDefaultsManager() {
  const [chargeCodes, setChargeCodes] = useState<ChargeCode[]>([])
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [accommodationId, setAccommodationId] = useState("")
  const [cityLedgerId, setCityLedgerId] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)

  useEffect(() => {
    Promise.all([
      fetch("/api/charge-codes").then(r => r.json()),
      fetch("/api/payment-methods").then(r => r.json()),
      fetch("/api/tenant-settings").then(r => r.json()),
    ])
      .then(([cc, pm, settings]) => {
        if (Array.isArray(cc)) setChargeCodes(cc)
        if (Array.isArray(pm)) setPaymentMethods(pm)
        setAccommodationId(settings?.defaultAccommodationChargeCodeId || "")
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
        body: JSON.stringify({
          defaultAccommodationChargeCodeId: accommodationId || "",
          cityLedgerPaymentMethodId: cityLedgerId || "",
        }),
      })
      if (res.ok) {
        setMessage({ text: "Posting defaults saved." })
      } else {
        const body = await res.json().catch(() => null)
        setMessage({ text: body?.error || "Failed to save.", error: true })
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
  }

  const cityLedgerMethods = paymentMethods.filter(pm => pm.type === "CITY_LEDGER")

  return (
    <div className="space-y-5 max-w-xl">
      <div className="space-y-2">
        <Label>Default Accommodation Charge Code</Label>
        <SearchableSelect
          value={accommodationId}
          onChange={setAccommodationId}
          placeholder="Select a room charge code..."
          options={[
            { value: "", label: "None" },
            ...chargeCodes
              .filter(c => c.category === "ROOM")
              .map(c => ({ label: `${c.code} — ${c.description}`, value: c.id })),
          ]}
        />
        <p className="text-xs text-muted-foreground">
          The charge code Night Audit posts the nightly room charge against when a rate plan
          doesn&apos;t set its own (Revenue &gt; Rate Plans).
        </p>
      </div>

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
        <Save className="w-4 h-4 mr-2" /> {saving ? "Saving..." : "Save Defaults"}
      </Button>
    </div>
  )
}
