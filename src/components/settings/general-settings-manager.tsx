"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Save, ShieldAlert } from "lucide-react"

export function GeneralSettingsManager() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState({
    resConfirmPrefix: "",
    resConfirmLength: 6,
    cashierDefaultFloat: 300,
    exchangeFromCurrency: "USD",
    exchangeToCurrency: "MVR",
  })

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/tenant-settings`)
      if (res.ok) {
        const data = await res.json()
        setFormData({
          resConfirmPrefix: data.resConfirmPrefix || "",
          resConfirmLength: data.resConfirmLength || 6,
          cashierDefaultFloat: data.cashierDefaultFloat ?? 300,
          exchangeFromCurrency: data.exchangeFromCurrency || "USD",
          exchangeToCurrency: data.exchangeToCurrency || "MVR",
        })
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
      const res = await fetch(`/api/tenant-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      })
      if (res.ok) {
        alert("Settings saved successfully!")
      } else {
        alert("Failed to save settings.")
      }
    } catch (e) {
      console.error(e)
      alert("Failed to save settings.")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-muted-foreground">Loading settings...</div>
  }

  return (
    <form onSubmit={handleSave} className="space-y-8">
      {/* Reservation Code Rules */}
      <div className="space-y-4">
        <div className="grid gap-6 sm:grid-cols-2 bg-muted p-6 rounded-xl border border-border">
          <div className="space-y-2">
            <Label>Reservation Prefix</Label>
            <Input 
              placeholder="e.g. GH- or RES-" 
              value={formData.resConfirmPrefix} 
              onChange={e => setFormData(p => ({ ...p, resConfirmPrefix: e.target.value.toUpperCase() }))} 
            />
            <p className="text-xs text-muted-foreground">
              A custom string attached to the front of every confirmation number.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Random Code Length</Label>
            <Input 
              type="number" 
              min="4" 
              max="12" 
              required 
              value={formData.resConfirmLength} 
              onChange={e => setFormData(p => ({ ...p, resConfirmLength: parseInt(e.target.value) || 6 }))} 
            />
            <p className="text-xs text-muted-foreground">
              The number of random alphanumeric characters to generate (4 to 12).
            </p>
          </div>
        </div>
      </div>

      {/* Cashiering Defaults */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Cashiering Defaults</h3>
          <p className="text-xs text-muted-foreground">
            Pre-filled values on the Cashiering page — staff can always override per shift/transaction.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-3 bg-muted p-6 rounded-xl border border-border">
          <div className="space-y-2">
            <Label>Default Opening Float</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={formData.cashierDefaultFloat}
              onChange={e => setFormData(p => ({ ...p, cashierDefaultFloat: parseFloat(e.target.value) || 0 }))}
            />
            <p className="text-xs text-muted-foreground">Cash in drawer when opening a shift.</p>
          </div>
          <div className="space-y-2">
            <Label>Exchange: From Currency</Label>
            <Input
              maxLength={8}
              value={formData.exchangeFromCurrency}
              onChange={e => setFormData(p => ({ ...p, exchangeFromCurrency: e.target.value.toUpperCase() }))}
            />
            <p className="text-xs text-muted-foreground">Currency guests usually hand over.</p>
          </div>
          <div className="space-y-2">
            <Label>Exchange: To Currency</Label>
            <Input
              maxLength={8}
              value={formData.exchangeToCurrency}
              onChange={e => setFormData(p => ({ ...p, exchangeToCurrency: e.target.value.toUpperCase() }))}
            />
            <p className="text-xs text-muted-foreground">Currency usually paid out.</p>
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-4 border-t">
        <Button type="submit" disabled={saving} className="">
          <Save className="w-4 h-4 mr-2" /> 
          {saving ? "Saving..." : "Save Configuration"}
        </Button>
      </div>
    </form>
  )
}
