"use client"

import { useEffect, useState } from "react"
import { chargeCodeOptions } from "@/lib/charge-code-options"
import { Save } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Skeleton } from "@/components/ui/skeleton"

type ChargeCode = {
  id: string
  code: string
  description: string
  isActive: boolean
  postingType: string
  chargeSubgroup?: { chargeGroup: { reportBucket: string } } | null
}

// The enterprise's role -> charge-code pointers (Controls > Cashiering). These are what
// resolveChargeCode() reads before falling back to the system-seeded code, so this panel
// is how a property redirects a role at its own codes without any literal code string
// living in the runtime. See src/lib/posting/resolve-charge-code.ts.
//
// City Ledger settlement is deliberately NOT here — it selects a Payment Method, which
// stays with Payment Methods under Finance (see SettlementDefaultsManager).
export function PostingDefaultsManager() {
  const [chargeCodes, setChargeCodes] = useState<ChargeCode[]>([])
  const [accommodationId, setAccommodationId] = useState("")
  const [greenTaxId, setGreenTaxId] = useState("")
  const [commissionId, setCommissionId] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)

  useEffect(() => {
    Promise.all([
      fetch("/api/charge-codes").then(r => r.json()),
      fetch("/api/tenant-settings").then(r => r.json()),
    ])
      .then(([cc, settings]) => {
        if (Array.isArray(cc)) setChargeCodes(cc)
        setAccommodationId(settings?.defaultAccommodationChargeCodeId || "")
        setGreenTaxId(settings?.defaultGreenTaxChargeCodeId || "")
        setCommissionId(settings?.commissionChargeCodeId || "")
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
          defaultGreenTaxChargeCodeId: greenTaxId || "",
          commissionChargeCodeId: commissionId || "",
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

  // Each role offers only codes that could legitimately play it: accommodation revenue,
  // a tax/levy code, and a non-revenue credit respectively.
  const NONE = { value: "", label: "None (use the system code)" }

  return (
    <div className="space-y-5 max-w-xl">
      <div className="space-y-2">
        <Label>Accommodation Charge Code</Label>
        <SearchableSelect
          value={accommodationId}
          onChange={setAccommodationId}
          placeholder="Select a room charge code..."
          options={[NONE, ...chargeCodeOptions(chargeCodes, { buckets: ["ROOM"] })]}
        />
        <p className="text-xs text-muted-foreground">
          What Night Audit posts the nightly room charge against when a rate plan
          doesn&apos;t set its own (Revenue &gt; Rate Plans).
        </p>
      </div>

      <div className="space-y-2">
        <Label>Green Tax Charge Code</Label>
        <SearchableSelect
          value={greenTaxId}
          onChange={setGreenTaxId}
          placeholder="Select a Green Tax charge code..."
          options={[NONE, ...chargeCodeOptions(chargeCodes, { includeTax: true, buckets: ["TAX"] })]}
        />
        <p className="text-xs text-muted-foreground">
          Where the nightly Green Tax levy posts. Its <em>rates</em> stay in Finance &gt; Tax
          &gt; Maldives Tax — this only chooses the code they land on. Must be a Tax / Levy
          code so it isn&apos;t itself service-charged or GST&apos;d.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Commission Charge Code</Label>
        <SearchableSelect
          value={commissionId}
          onChange={setCommissionId}
          placeholder="Select a commission charge code..."
          options={[
            { value: "", label: "None (disables commission posting)" },
            ...chargeCodeOptions(chargeCodes, { includeNonRevenue: true }),
          ]}
        />
        <p className="text-xs text-muted-foreground">
          Where a Travel Agent commission credit posts when a City Ledger folio settles to a
          debtor account at checkout (Client Relations &gt; Negotiated Rates). Best kept under
          a Non-Revenue group so it doesn&apos;t inflate revenue reporting. Leave unset to
          disable commission posting entirely.
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
