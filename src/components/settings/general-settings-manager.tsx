"use client"

import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { InfoHint } from "@/components/ui/info-hint"
import { InlineLoading } from "@/components/ui/inline-loading"
import { SectionSaveFooter, type SaveStatus } from "@/components/controls/save-status"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"

// Cashiering defaults only. The booking-number format that used to share this form is
// per property now (BookingNumberFormatForm, Hub › property › Reservations).
type SettingsForm = {
  cashierDefaultFloat: number
  exchangeFromCurrency: string
  exchangeToCurrency: string
}

const DEFAULT_FORM: SettingsForm = {
  cashierDefaultFloat: 300,
  exchangeFromCurrency: "USD",
  exchangeToCurrency: "MVR",
}

export function GeneralSettingsManager({ propertyId }: { propertyId: string }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState<SettingsForm>(DEFAULT_FORM)
  // Dirty/saved status drives the inline save hint (Settings.dc.html "Form only" card)
  // instead of a blocking alert(). Editing any field clears "saved" and marks dirty; a
  // successful save flips it back. `update` is the single mutation entry point so no
  // field can change state without also flagging the form dirty.
  const [status, setStatus] = useState<SaveStatus>("idle")

  const update = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
    setFormData((p) => ({ ...p, [key]: value }))
    setStatus("dirty")
  }

  useEffect(() => {
    fetchSettings()
  }, [propertyId])

  const fetchSettings = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/properties/${propertyId}/settings`)
      if (res.ok) {
        const data = await res.json()
        setFormData({
          cashierDefaultFloat: data.cashierDefaultFloat ?? 300,
          exchangeFromCurrency: data.exchangeFromCurrency || "USD",
          exchangeToCurrency: data.exchangeToCurrency || "MVR",
        })
        setStatus("idle")
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch(`/api/properties/${propertyId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      })
      if (res.ok) {
        setStatus("saved")
      } else {
        setStatus("dirty")
        toast.error(await apiError(res, "Couldn't save the cashiering defaults. Try again."))
      }
    } catch (e) {
      console.error(e)
      setStatus("dirty")
      toast.error("Couldn't save the cashiering defaults. Try again.")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <InlineLoading className="py-12" label="Loading settings" />
  }

  return (
    <form onSubmit={handleSave} className="space-y-8">
      {/* Cashiering Defaults — separated from the section above by a line, not a box. */}
      <div className="space-y-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            Cashiering defaults
            <InfoHint label="Cashiering defaults">Pre-filled values on the Cashiering page — staff can always override per shift/transaction.</InfoHint>
          </h3>
        </div>
        <div className="grid gap-6 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Default opening float</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={formData.cashierDefaultFloat}
              onChange={e => update("cashierDefaultFloat", parseFloat(e.target.value) || 0)}
            />
            <p className="text-xs text-muted-foreground">Cash in drawer when opening a shift.</p>
          </div>
          <div className="space-y-2">
            <Label>Exchange: from currency</Label>
            <Input
              maxLength={8}
              value={formData.exchangeFromCurrency}
              onChange={e => update("exchangeFromCurrency", e.target.value.toUpperCase())}
            />
            <p className="text-xs text-muted-foreground">Currency guests usually hand over.</p>
          </div>
          <div className="space-y-2">
            <Label>Exchange: to currency</Label>
            <Input
              maxLength={8}
              value={formData.exchangeToCurrency}
              onChange={e => update("exchangeToCurrency", e.target.value.toUpperCase())}
            />
            <p className="text-xs text-muted-foreground">Currency usually paid out.</p>
          </div>
        </div>
      </div>

      <SectionSaveFooter status={status} saving={saving} />
    </form>
  )
}
