"use client"

import { useState } from "react"
import { Check, Ban } from "lucide-react"
import { useProperty } from "@/components/providers/property-provider"
import { THEME_COLOR_NAMES, THEME_COLOR_PRESETS } from "@/lib/themePresets"
import { cn } from "@/lib/utils"

// Sets the CURRENT property's own banner accent — a thin line shown at the top of every
// page while this property is active (see property-banner-bar.tsx). Deliberately scoped
// to one property at a time, not the enterprise: switching properties in the header
// switches which property's banner (and this picker) is in effect. A curated preset list
// today; Property.bannerColor stores a raw hex so a free-form picker can replace this
// UI later without a schema change.
export function PropertyBannerColorManager() {
  const { currentProperty, setCurrentProperty } = useProperty()
  const [saving, setSaving] = useState<string | null>(null)

  if (!currentProperty) {
    return <div className="py-8 text-center text-muted-foreground">Loading property...</div>
  }

  const handleSelect = async (hex: string | null) => {
    setSaving(hex ?? "none")
    try {
      const res = await fetch(`/api/properties/${currentProperty.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bannerColor: hex }),
      })
      if (res.ok) {
        setCurrentProperty({ ...currentProperty, bannerColor: hex })
      }
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Sets the accent line shown at the top of every page while <strong>{currentProperty.name}</strong> is the
        active property. Each property has its own — switching properties switches the banner too.
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
        <button
          type="button"
          disabled={saving !== null}
          onClick={() => handleSelect(null)}
          className={cn(
            "flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-colors",
            !currentProperty.bannerColor ? "border-foreground" : "border-transparent hover:border-border"
          )}
        >
          <span className="w-10 h-10 rounded-none flex items-center justify-center shadow-sm bg-muted text-muted-foreground">
            {!currentProperty.bannerColor ? <Check className="w-5 h-5" /> : <Ban className="w-4 h-4" />}
          </span>
          <span className="text-xs font-medium text-muted-foreground">None</span>
        </button>
        {THEME_COLOR_NAMES.map((name) => {
          const preset = THEME_COLOR_PRESETS[name]
          const isSelected = currentProperty.bannerColor === preset.primary
          return (
            <button
              key={name}
              type="button"
              disabled={saving !== null}
              onClick={() => handleSelect(preset.primary)}
              className={cn(
                "flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-colors",
                isSelected ? "border-foreground" : "border-transparent hover:border-border"
              )}
            >
              <span
                className="w-10 h-10 rounded-none flex items-center justify-center shadow-sm"
                style={{ backgroundColor: preset.primary }}
              >
                {isSelected && <Check className="w-5 h-5" style={{ color: preset.primaryForeground }} />}
              </span>
              <span className="text-xs font-medium text-muted-foreground">{preset.label.replace(" (Default)", "")}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
