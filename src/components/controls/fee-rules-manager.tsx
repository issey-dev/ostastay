"use client"

import { useEffect, useState } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Skeleton } from "@/components/ui/skeleton"
import { Save } from "@/components/icons"

type FeeRule = {
  ruleType: "DEPOSIT" | "CANCELLATION" | "NO_SHOW"
  basis: string
  value: number
  chargeCodeId: string | null
  isActive: boolean
}

const RULE_META: Record<FeeRule["ruleType"], { label: string; blurb: string; needsCode: boolean }> = {
  DEPOSIT: { label: "Deposit", blurb: "Suggested pre-arrival deposit to request.", needsCode: false },
  CANCELLATION: { label: "Cancellation fee", blurb: "Prompted to collect when a reservation is cancelled.", needsCode: true },
  NO_SHOW: { label: "No-show fee", blurb: "Applied at Night Audit when a guest never arrives.", needsCode: true },
}

const BASIS_OPTIONS = [
  { value: "FLAT", label: "Flat amount ($)" },
  { value: "PERCENT", label: "% of stay" },
  { value: "FIRST_NIGHT", label: "First night" },
  { value: "FULL_STAY", label: "Full stay" },
]

export function FeeRulesManager() {
  const { currentProperty } = useProperty()
  const [rules, setRules] = useState<FeeRule[]>([])
  const [chargeCodes, setChargeCodes] = useState<{ id: string; code: string; description: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [savingType, setSavingType] = useState<string | null>(null)
  const [savedType, setSavedType] = useState<string | null>(null)

  useEffect(() => {
    if (!currentProperty) return
    setLoading(true)
    Promise.all([
      fetch(`/api/settings/fee-rules?propertyId=${currentProperty.id}`).then((r) => r.json()),
      fetch(`/api/charge-codes?enterpriseId=${currentProperty.enterpriseId}`).then((r) => r.json()),
    ])
      .then(([ruleData, codeData]) => {
        if (Array.isArray(ruleData)) setRules(ruleData)
        if (Array.isArray(codeData)) setChargeCodes(codeData)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [currentProperty])

  const patch = (ruleType: string, changes: Partial<FeeRule>) =>
    setRules((prev) => prev.map((r) => (r.ruleType === ruleType ? { ...r, ...changes } : r)))

  const save = async (rule: FeeRule) => {
    if (!currentProperty) return
    setSavingType(rule.ruleType)
    setSavedType(null)
    try {
      const res = await fetch(`/api/settings/fee-rules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: currentProperty.id, ...rule }),
      })
      if (res.ok) {
        setSavedType(rule.ruleType)
        setTimeout(() => setSavedType(null), 2000)
      } else {
        const data = await res.json()
        alert(data.error || "Failed to save the rule.")
      }
    } catch {
      alert("Failed to save the rule.")
    } finally {
      setSavingType(null)
    }
  }

  if (loading) {
    return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}</div>
  }

  return (
    <div className="space-y-4">
      {rules.map((rule) => {
        const meta = RULE_META[rule.ruleType]
        const showValue = rule.basis === "FLAT" || rule.basis === "PERCENT"
        return (
          <div key={rule.ruleType} className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-foreground">{meta.label}</p>
                <p className="text-xs text-muted-foreground">{meta.blurb}</p>
              </div>
              <Switch checked={rule.isActive} onCheckedChange={(v) => patch(rule.ruleType, { isActive: !!v })} />
            </div>

            {rule.isActive && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Amount basis</Label>
                  <SearchableSelect
                    value={rule.basis}
                    onChange={(v: string) => patch(rule.ruleType, { basis: v })}
                    placeholder="Basis..."
                    options={BASIS_OPTIONS}
                  />
                </div>
                {showValue && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">{rule.basis === "PERCENT" ? "Percent (%)" : "Amount ($)"}</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={rule.value}
                      onChange={(e) => patch(rule.ruleType, { value: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                )}
                {meta.needsCode && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Charge code</Label>
                    <SearchableSelect
                      value={rule.chargeCodeId ?? ""}
                      onChange={(v: string) => patch(rule.ruleType, { chargeCodeId: v || null })}
                      placeholder="Select code..."
                      options={chargeCodes.map((c) => ({ value: c.id, label: `${c.code} — ${c.description}` }))}
                    />
                  </div>
                )}
                <div className="flex items-end">
                  <Button size="sm" onClick={() => save(rule)} disabled={savingType === rule.ruleType}>
                    <Save className="w-4 h-4 mr-2" />
                    {savingType === rule.ruleType ? "Saving..." : savedType === rule.ruleType ? "Saved" : "Save"}
                  </Button>
                </div>
              </div>
            )}
            {!rule.isActive && (
              <Button size="sm" variant="outline" onClick={() => save(rule)} disabled={savingType === rule.ruleType}>
                {savingType === rule.ruleType ? "Saving..." : savedType === rule.ruleType ? "Saved" : "Save (off)"}
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}
