"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Check } from "lucide-react"
import { THEME_COLOR_NAMES, THEME_COLOR_PRESETS, type ThemeColorName } from "@/lib/themePresets"
import { cn } from "@/lib/utils"

export function ThemeColorManager() {
  const [selected, setSelected] = useState<ThemeColorName>("indigo")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/tenant-settings")
      .then((res) => res.json())
      .then((data) => {
        if (data?.themeColor && THEME_COLOR_NAMES.includes(data.themeColor)) setSelected(data.themeColor)
      })
      .finally(() => setLoading(false))
  }, [])

  const handleSelect = async (color: ThemeColorName) => {
    setSelected(color)
    setSaving(true)
    try {
      await fetch("/api/tenant-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeColor: color }),
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="py-8 text-center text-muted-foreground">Loading theme...</div>

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Sets the app&apos;s primary accent color for every user in this enterprise. Changes apply on next page load.
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
        {THEME_COLOR_NAMES.map((name) => {
          const preset = THEME_COLOR_PRESETS[name]
          const isSelected = selected === name
          return (
            <button
              key={name}
              type="button"
              onClick={() => handleSelect(name)}
              disabled={saving}
              className={cn(
                "flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-colors",
                isSelected ? "border-foreground" : "border-transparent hover:border-border"
              )}
            >
              <span
                className="w-10 h-10 rounded-full flex items-center justify-center shadow-sm"
                style={{ backgroundColor: preset.primary }}
              >
                {isSelected && <Check className="w-5 h-5" style={{ color: preset.primaryForeground }} />}
              </span>
              <span className="text-xs font-medium text-muted-foreground">{preset.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
