"use client"

import { useEffect, useRef, useState } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Skeleton } from "@/components/ui/skeleton"
import { Save, Plus, Trash2 } from "@/components/icons"
import { toast } from "@/lib/toast"

type RuleType = "DEPOSIT" | "CANCELLATION" | "NO_SHOW"

type FeeRule = {
  id: string | null
  _key: string // stable client-side key (server id once saved, else a temp key)
  name: string
  ruleType: RuleType
  basis: string
  value: number
  chargeCodeId: string | null
  isActive: boolean
}

const RULE_TYPES: RuleType[] = ["DEPOSIT", "CANCELLATION", "NO_SHOW"]

const RULE_META: Record<RuleType, { label: string; blurb: string; needsCode: boolean }> = {
  DEPOSIT: { label: "Deposit", blurb: "Suggested pre-arrival deposit rules. Pick one on a reservation to drive its requested deposit.", needsCode: false },
  CANCELLATION: { label: "Cancellation fees", blurb: "Fee policies prompted when a reservation is cancelled. Pick one per reservation.", needsCode: true },
  NO_SHOW: { label: "No-show fees", blurb: "Fee policies posted at Night Audit when a guest never arrives. Pick one per reservation.", needsCode: true },
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
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const tmpCounter = useRef(0)

  useEffect(() => {
    if (!currentProperty) return
    setLoading(true)
    Promise.all([
      fetch(`/api/settings/fee-rules?propertyId=${currentProperty.id}`).then((r) => r.json()),
      fetch(`/api/charge-codes?enterpriseId=${currentProperty.enterpriseId}`).then((r) => r.json()),
    ])
      .then(([ruleData, codeData]) => {
        if (Array.isArray(ruleData)) {
          setRules(ruleData.map((r: Omit<FeeRule, "_key">) => ({ ...r, _key: r.id as string })))
        }
        if (Array.isArray(codeData)) setChargeCodes(codeData)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [currentProperty])

  const patch = (key: string, changes: Partial<FeeRule>) =>
    setRules((prev) => prev.map((r) => (r._key === key ? { ...r, ...changes } : r)))

  const addRule = (ruleType: RuleType) => {
    const _key = `new-${tmpCounter.current++}`
    setRules((prev) => [...prev, { id: null, _key, name: "", ruleType, basis: "FLAT", value: 0, chargeCodeId: null, isActive: true }])
  }

  const save = async (rule: FeeRule) => {
    if (!currentProperty) return
    if (!rule.name.trim()) { toast.error("Give the rule a name first."); return }
    setSavingKey(rule._key)
    setSavedKey(null)
    try {
      const res = await fetch(`/api/settings/fee-rules`, {
        method: rule.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: currentProperty.id, ...rule }),
      })
      if (res.ok) {
        const saved = await res.json()
        setRules((prev) => prev.map((r) => (r._key === rule._key ? { ...r, id: saved.id } : r)))
        setSavedKey(rule._key)
        setTimeout(() => setSavedKey((k) => (k === rule._key ? null : k)), 2000)
      } else {
        toast.error((await res.json()).error || "Failed to save the rule.")
      }
    } catch {
      toast.error("Failed to save the rule.")
    } finally {
      setSavingKey(null)
    }
  }

  const remove = async (rule: FeeRule) => {
    if (rule.id) {
      if (!window.confirm(`Delete "${rule.name || "this rule"}"? Reservations using it will fall back to no fee.`)) return
      try {
        const res = await fetch(`/api/settings/fee-rules?id=${rule.id}`, { method: "DELETE" })
        if (!res.ok) { toast.error((await res.json()).error || "Failed to delete the rule."); return }
      } catch {
        toast.error("Failed to delete the rule.")
        return
      }
    }
    setRules((prev) => prev.filter((r) => r._key !== rule._key))
  }

  if (loading) {
    return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}</div>
  }

  return (
    <div className="space-y-6">
      {RULE_TYPES.map((ruleType) => {
        const meta = RULE_META[ruleType]
        const typeRules = rules.filter((r) => r.ruleType === ruleType)
        return (
          <div key={ruleType} className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-foreground">{meta.label}</p>
                <p className="text-xs text-muted-foreground">{meta.blurb}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => addRule(ruleType)}>
                <Plus className="w-4 h-4 mr-1.5" /> Add rule
              </Button>
            </div>

            {typeRules.length === 0 && (
              <p className="text-xs text-muted-foreground italic border border-dashed border-border rounded-lg px-3 py-4 text-center">
                No {meta.label.toLowerCase()} yet.
              </p>
            )}

            {typeRules.map((rule) => {
              const showValue = rule.basis === "FLAT" || rule.basis === "PERCENT"
              return (
                <div key={rule._key} className="rounded-lg border border-border p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <Input
                      className="flex-1"
                      placeholder="Rule name (e.g. Standard, Peak season)"
                      value={rule.name}
                      onChange={(e) => patch(rule._key, { name: e.target.value })}
                    />
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Label className="text-xs text-muted-foreground">Active</Label>
                      <Switch checked={rule.isActive} onCheckedChange={(v) => patch(rule._key, { isActive: !!v })} />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Amount basis</Label>
                      <SearchableSelect
                        value={rule.basis}
                        onChange={(v: string) => patch(rule._key, { basis: v })}
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
                          onChange={(e) => patch(rule._key, { value: parseFloat(e.target.value) || 0 })}
                        />
                      </div>
                    )}
                    {meta.needsCode && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Charge code</Label>
                        <SearchableSelect
                          value={rule.chargeCodeId ?? ""}
                          onChange={(v: string) => patch(rule._key, { chargeCodeId: v || null })}
                          placeholder="Select code..."
                          options={chargeCodes.map((c) => ({ value: c.id, label: `${c.code} — ${c.description}` }))}
                        />
                      </div>
                    )}
                    <div className="flex items-end gap-2">
                      <Button size="sm" onClick={() => save(rule)} disabled={savingKey === rule._key}>
                        <Save className="w-4 h-4 mr-2" />
                        {savingKey === rule._key ? "Saving..." : savedKey === rule._key ? "Saved" : "Save"}
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        className="text-destructive border-destructive/40 hover:bg-destructive-muted hover:text-destructive"
                        onClick={() => remove(rule)}
                        title="Delete rule"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
