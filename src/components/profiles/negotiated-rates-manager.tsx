"use client"

import { useCallback, useEffect, useState } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { ErrorState } from "@/components/ui/error-state"

type AvailableRatePlan = { id: string; name: string; code: string; propertyId: string; propertyName: string }
type Link = { ratePlanId: string; commissionRate: number | null }

// Links this Company/Travel Agent profile to specific negotiated Rate Plans, each with
// an optional commission % owed to this agent (see RatePlanAgentAccess) — only these
// profiles will be able to book with a negotiated plan on the reservation form, and
// only a linked plan with a commission % set generates a commission credit at checkout
// (see reservations/[id]/check-out/route.ts). Whole-set replace on every change, same
// convention as PreferencesEditor.
export function NegotiatedRatesManager({ upid }: { upid: string }) {
  const [available, setAvailable] = useState<AvailableRatePlan[]>([])
  const [links, setLinks] = useState<Link[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)

  const fetchRates = useCallback(() => {
    setLoading(true)
    setLoadError(false)
    fetch(`/api/profiles/${upid}/negotiated-rates`)
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((data) => {
        setAvailable(data.available ?? [])
        setLinks(data.links ?? [])
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [upid])

  useEffect(() => { fetchRates() }, [fetchRates])

  const save = async (next: Link[]) => {
    setLinks(next)
    setSaving(true)
    try {
      await fetch(`/api/profiles/${upid}/negotiated-rates`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links: next }),
      })
    } finally {
      setSaving(false)
    }
  }

  const toggle = (ratePlanId: string, checked: boolean) => {
    const next = checked
      ? [...links, { ratePlanId, commissionRate: null }]
      : links.filter((l) => l.ratePlanId !== ratePlanId)
    save(next)
  }

  const setCommission = (ratePlanId: string, value: string) => {
    const commissionRate = value === "" ? null : parseFloat(value)
    setLinks((prev) => prev.map((l) => (l.ratePlanId === ratePlanId ? { ...l, commissionRate } : l)))
  }

  const commitCommission = (_ratePlanId: string) => {
    save(links)
  }

  if (loading) return <p className="text-xs text-muted-foreground">Loading...</p>
  if (loadError) return <ErrorState title="Couldn't load negotiated rates" onRetry={fetchRates} />
  if (available.length === 0) {
    return <p className="text-xs text-muted-foreground italic">No negotiated rate plans exist yet — mark a Rate Plan as negotiated in Revenue &gt; Rate Plans first.</p>
  }

  const byProperty = available.reduce<Record<string, AvailableRatePlan[]>>((acc, rp) => {
    (acc[rp.propertyName] ??= []).push(rp)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      {Object.entries(byProperty).map(([propertyName, plans]) => (
        <div key={propertyName}>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">{propertyName}</p>
          <div className="flex flex-col gap-2">
            {plans.map((rp) => {
              const link = links.find((l) => l.ratePlanId === rp.id)
              const checked = !!link
              return (
                <div key={rp.id} className="flex items-center gap-3">
                  <Checkbox
                    id={`rp-${rp.id}`}
                    checked={checked}
                    disabled={saving}
                    onCheckedChange={(c) => toggle(rp.id, !!c)}
                  />
                  <Label htmlFor={`rp-${rp.id}`} className="cursor-pointer font-normal text-sm flex-1">
                    {rp.name} <span className="text-muted-foreground text-xs">({rp.code})</span>
                  </Label>
                  {checked && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        placeholder="Commission %"
                        className="w-28 h-8 text-sm"
                        disabled={saving}
                        value={link?.commissionRate ?? ""}
                        onChange={(e) => setCommission(rp.id, e.target.value)}
                        onBlur={() => commitCommission(rp.id)}
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Optional. A rate plan with a commission % set posts a credit against the enterprise&apos;s Commission charge code (Controls &gt; Finance) once a booking through this agent settles to their City Ledger account at checkout.
      </p>
    </div>
  )
}
