"use client"

import { useCallback, useEffect, useState } from "react"
import { SystemCodeMultiSelect } from "@/components/ui/system-code-multi-select"
import { ErrorState } from "@/components/ui/error-state"

// Wires SystemCodeMultiSelect (chip picker) to a profile's ProfilePreference rows for
// one category — saves the whole selection immediately on each toggle (see
// /api/profiles/[upid]/preferences). Used for both Dietary Requirements
// (category="DIETARY") and the general Preferences list (category="PREFERENCE").
export function PreferencesEditor({ upid, category, lovCategory }: { upid: string; category: string; lovCategory: string }) {
  const [values, setValues] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)

  const fetchPreferences = useCallback(() => {
    setLoading(true)
    setLoadError(false)
    fetch(`/api/profiles/${upid}/preferences`)
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((data) => {
        if (Array.isArray(data)) {
          setValues(data.filter((p: { category: string; value: string }) => p.category === category).map((p: { value: string }) => p.value))
        }
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [upid, category])

  useEffect(() => { fetchPreferences() }, [fetchPreferences])

  const handleChange = async (next: string[]) => {
    setValues(next)
    setSaving(true)
    try {
      await fetch(`/api/profiles/${upid}/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, values: next }),
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-xs text-muted-foreground">Loading...</p>
  if (loadError) return <ErrorState title="Couldn't load preferences" onRetry={fetchPreferences} />

  return <SystemCodeMultiSelect category={lovCategory} values={values} onChange={handleChange} disabled={saving} />
}
