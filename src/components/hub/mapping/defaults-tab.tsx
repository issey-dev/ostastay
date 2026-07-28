"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/ui/error-state"
import { toast } from "@/lib/toast"
import type { RatePlanMap } from "@/components/hub/mapping/rate-plan-tab"

type MealPlan = { code: string; name: string }

type Defaults = { ratePlanId: string | null; mealPlanCode: string }

// What to fill in when an inbound booking arrives without it — a channel booking confirms
// a stay and a price, never which of THIS property's rate plans or meal plans it should
// attach to (src/lib/channels/defaults.ts). Configured once here, used by every subsequent
// conversion (src/lib/channels/inbound/convert.ts) until changed.
export function DefaultsTab({
  linkId,
  propertyId,
  ratePlans,
  canManage,
}: {
  linkId: string
  propertyId: string
  ratePlans: RatePlanMap[]
  canManage: boolean
}) {
  const [defaults, setDefaults] = useState<Defaults | null>(null)
  const [mealPlans, setMealPlans] = useState<MealPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const [defRes, mealRes] = await Promise.all([
        fetch(`/api/hub/property-links/${linkId}/defaults`),
        fetch(`/api/meal-plans?propertyId=${propertyId}`),
      ])
      if (!defRes.ok) throw new Error("failed")
      const defData = await defRes.json()
      setDefaults({ ratePlanId: defData.ratePlanId, mealPlanCode: defData.mealPlanCode })
      // Meal plans are informational elsewhere in the app too — a property that hasn't
      // configured any yet should still be able to pick "None" here rather than get stuck.
      setMealPlans(mealRes.ok ? await mealRes.json() : [])
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [linkId, propertyId])

  useEffect(() => {
    void load()
  }, [load])

  const handleSave = async () => {
    if (!defaults) return
    setSaving(true)
    try {
      const res = await fetch(`/api/hub/property-links/${linkId}/defaults`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ratePlanId: defaults.ratePlanId, mealPlanCode: defaults.mealPlanCode }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Could not save")
        return
      }
      toast.success("Defaults saved")
      setDefaults({ ratePlanId: data.ratePlanId, mealPlanCode: data.mealPlanCode })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Skeleton className="h-40 w-full" />
  if (failed || !defaults) return <ErrorState onRetry={() => void load()} />

  return (
    <div className="max-w-lg space-y-5">
      <p className="text-sm text-muted-foreground">
        A channel booking confirms a stay and a price, but never one of this property&rsquo;s rate plans or meal
        plans. Without a default rate plan configured here, an inbound booking is held for the desk to resolve by
        hand rather than converted automatically.
      </p>

      <div className="space-y-2">
        <Label>Default rate plan</Label>
        <SearchableSelect
          value={defaults.ratePlanId ?? ""}
          onChange={(v) => setDefaults({ ...defaults, ratePlanId: v || null })}
          placeholder="Choose a rate plan..."
          disabled={!canManage}
          options={ratePlans.map((rp) => ({ label: `${rp.ratePlanName} (${rp.ratePlanCode})`, value: rp.ratePlanId }))}
        />
        {!defaults.ratePlanId && (
          <p className="text-xs text-muted-foreground">
            Required for automatic conversion — bookings will accumulate unconverted until one is chosen.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Default meal plan</Label>
        <Select
          value={defaults.mealPlanCode}
          onValueChange={(v) => setDefaults({ ...defaults, mealPlanCode: v ?? "NONE" })}
          disabled={!canManage}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="NONE">None (room only)</SelectItem>
            {mealPlans.map((mp) => (
              <SelectItem key={mp.code} value={mp.code}>
                {mp.name} ({mp.code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {canManage && (
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? "Saving..." : "Save defaults"}
        </Button>
      )}
    </div>
  )
}
