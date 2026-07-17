"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { KeyRound, Building2 } from "lucide-react"
import { MODULES, MODULE_LABELS } from "@/lib/modules"

type EnterpriseRow = {
  id: string
  name: string
  slug: string
  license: { tier: string; maxProperties: number } | null
  _count: { properties: number; users: number }
}

type License = { tier: string; maxProperties: number; notes: string | null; propertyCount: number }
type TierModuleRow = { tier: string; module: string; enabled: boolean }

const TIERS = ["STANDARD", "PRO", "MAX"]

export function LicensingManager() {
  const [enterprises, setEnterprises] = useState<EnterpriseRow[]>([])
  const [selectedId, setSelectedId] = useState<string>("")
  const [license, setLicense] = useState<License | null>(null)
  const [form, setForm] = useState({ tier: "STANDARD", maxProperties: "1", notes: "" })
  const [tierModules, setTierModules] = useState<TierModuleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const fetchEnterprises = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/enterprises")
      if (res.ok) {
        const data: EnterpriseRow[] = await res.json()
        setEnterprises(data)
        if (data.length > 0 && !selectedId) setSelectedId(data[0].id)
      }
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { fetchEnterprises() }, [fetchEnterprises])

  const fetchLicense = useCallback(async (enterpriseId: string) => {
    const res = await fetch(`/api/licenses?enterpriseId=${enterpriseId}`)
    if (res.ok) {
      const data: License = await res.json()
      setLicense(data)
      setForm({ tier: data.tier, maxProperties: String(data.maxProperties), notes: data.notes ?? "" })
    }
  }, [])

  const fetchTierModules = useCallback(async (tier: string) => {
    const res = await fetch(`/api/licenses/tier-modules?tier=${tier}`)
    if (res.ok) setTierModules(await res.json())
  }, [])

  useEffect(() => {
    if (selectedId) fetchLicense(selectedId)
  }, [selectedId, fetchLicense])

  useEffect(() => {
    if (form.tier) fetchTierModules(form.tier)
  }, [form.tier, fetchTierModules])

  const handleSaveLicense = async () => {
    setSaving(true)
    setErrorMsg(null)
    try {
      const res = await fetch("/api/licenses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enterpriseId: selectedId, tier: form.tier, maxProperties: parseInt(form.maxProperties), notes: form.notes }),
      })
      if (res.ok) {
        await Promise.all([fetchLicense(selectedId), fetchEnterprises()])
      } else {
        const err = await res.json()
        setErrorMsg(err.error || "Failed to save license")
      }
    } finally {
      setSaving(false)
    }
  }

  const toggleTierModule = async (module: string, enabled: boolean) => {
    setTierModules((prev) => prev.map((m) => (m.module === module ? { ...m, enabled } : m)))
    await fetch("/api/licenses/tier-modules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier: form.tier, module, enabled }),
    })
  }

  const selected = enterprises.find((e) => e.id === selectedId)

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading enterprises...</div>

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-1"><Building2 className="w-4 h-4" /> Enterprise</label>
        <Select value={selectedId} onValueChange={(v) => setSelectedId(v ?? "")}>
          <SelectTrigger className="max-w-md"><SelectValue placeholder="Select an enterprise">{selected?.name}</SelectValue></SelectTrigger>
          <SelectContent>
            {enterprises.map((e) => (
              <SelectItem key={e.id} value={e.id}>{e.name} ({e.slug})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {enterprises.length === 0 && <p className="text-sm text-muted-foreground">No customer enterprises exist yet.</p>}
      </div>

      {selected && license && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><KeyRound className="w-4 h-4" /> License</CardTitle>
              <CardDescription>
                {selected.name} is currently using {license.propertyCount} of {license.maxProperties} allowed propert{license.maxProperties === 1 ? "y" : "ies"}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {errorMsg && <div className="bg-destructive-muted border border-destructive/30 text-destructive text-sm p-3 rounded-md">{errorMsg}</div>}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Tier</label>
                  <Select value={form.tier} onValueChange={(v) => setForm({ ...form, tier: v ?? "STANDARD" })}>
                    <SelectTrigger><SelectValue>{form.tier}</SelectValue></SelectTrigger>
                    <SelectContent>
                      {TIERS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Max Properties</label>
                  <Input type="number" min={0} value={form.maxProperties} onChange={(e) => setForm({ ...form, maxProperties: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Notes</label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Internal note about this license (optional)" />
              </div>
              <Button className="" onClick={handleSaveLicense} disabled={saving}>
                {saving ? "Saving..." : "Save License"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Module Access — {form.tier} tier</CardTitle>
              <CardDescription>
                Scaffold only — every module currently defaults to enabled until Standard/Pro/Max feature tiers are finalized.
                Changes here apply to <strong>every</strong> enterprise on the {form.tier} tier.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
                {MODULES.map((module) => {
                  const row = tierModules.find((m) => m.module === module)
                  return (
                    <div key={module} className="flex items-center justify-between border-b pb-2">
                      <span className="text-sm">{MODULE_LABELS[module]}</span>
                      <div className="flex items-center gap-2">
                        {row?.enabled ? (
                          <Badge variant="secondary" className="bg-success-muted text-success">Enabled</Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-muted text-muted-foreground">Disabled</Badge>
                        )}
                        <Switch checked={row?.enabled ?? true} onCheckedChange={(checked) => toggleTierModule(module, !!checked)} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
