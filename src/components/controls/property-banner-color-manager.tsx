"use client"

import { useState } from "react"
import { Check, Ban, Loader2 } from "lucide-react"
import { useProperty } from "@/components/providers/property-provider"
import { THEME_COLOR_NAMES, THEME_COLOR_PRESETS } from "@/lib/themePresets"
import { cn } from "@/lib/utils"

// Sets the CURRENT property's own banner accent — a thin line shown at the top of every
// page while this property is active (see property-banner-bar.tsx). Deliberately scoped
// to one property at a time, not the enterprise: switching properties in the header
// switches which property's banner (and this picker) is in effect. A curated preset list
// today; Property.bannerColor stores a raw hex so a free-form picker can replace this
// UI later without a schema change.
//
// Layout follows the "Appearance Picker" design-system spec (claude.ai/design project
// "Interactive color panel states"): a live banner preview above a left-aligned swatch
// grid, where hovering a swatch previews it in the strip without committing. Adapted in
// three ways: the spec's page header is dropped (ControlsCard already renders the title
// and description), its "Interaction states" row is dropped (that's spec documentation,
// not product UI), and its hardcoded light-mode greys are mapped onto the app's own
// tokens so the panel works in dark mode.

// "No accent" reads as an absence, not another colour — a faint diagonal hatch, same
// idea as the spec's neutral-on-neutral stripe. Uses --border/--card rather than the
// spec's equivalent of --muted/--background: in this app's light palette those two are
// #f1f5f9 and #f8fafc, seven units apart, so the stripes were invisible. --border on
// --card reads clearly in both themes (#e2e8f0 on #fff, #404040 on #171717).
const NONE_HATCH =
  "repeating-linear-gradient(45deg, var(--border) 0 6px, var(--card) 6px 12px)"

type Swatch = {
  id: string
  name: string
  hex: string | null
  foreground: string | null
}

const SWATCHES: Swatch[] = [
  { id: "none", name: "None", hex: null, foreground: null },
  ...THEME_COLOR_NAMES.map((name) => ({
    id: name,
    name: THEME_COLOR_PRESETS[name].label.replace(" (Default)", ""),
    hex: THEME_COLOR_PRESETS[name].primary,
    foreground: THEME_COLOR_PRESETS[name].primaryForeground,
  })),
]

export function PropertyBannerColorManager() {
  const { currentProperty, setCurrentProperty } = useProperty()
  const [saving, setSaving] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  if (!currentProperty) {
    return <div className="py-8 text-center text-muted-foreground">Loading property...</div>
  }

  const selected =
    SWATCHES.find((s) => s.hex === currentProperty.bannerColor) ?? SWATCHES[0]
  // Hover drives the preview strip only — nothing is written until the swatch is clicked.
  const previewed = (hovered && SWATCHES.find((s) => s.id === hovered)) || selected
  const isPreviewing = previewed.id !== selected.id

  const handleSelect = async (swatch: Swatch) => {
    setSaving(swatch.id)
    try {
      const res = await fetch(`/api/properties/${currentProperty.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bannerColor: swatch.hex }),
      })
      if (res.ok) {
        setCurrentProperty({ ...currentProperty, bannerColor: swatch.hex })
      }
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground max-w-[60ch]">
        Sets the accent line shown at the top of every page while{" "}
        <strong className="text-foreground">{currentProperty.name}</strong> is the active property. Each
        property has its own — switching properties switches the banner too.
      </p>

      {/* Live preview: a miniature of the page chrome, so the choice is judged in situ
          rather than as an abstract square. Mirrors PropertyBannerBar's own placement. */}
      <div className="overflow-hidden rounded-md border bg-card">
        <div
          className="h-1.5 w-full transition-[background] duration-200"
          style={{ background: previewed.hex ?? NONE_HATCH }}
        />
        <div className="flex items-center justify-between gap-4 px-4 py-3.5">
          <div className="flex flex-col gap-1.5" aria-hidden>
            <div className="h-2 w-[180px] rounded-full bg-muted-foreground/25" />
            <div className="h-2 w-[120px] rounded-full bg-muted-foreground/15" />
          </div>
          <div
            className={cn(
              "text-[11px] font-medium uppercase tracking-wider tabular-nums transition-colors",
              isPreviewing ? "text-muted-foreground" : "text-foreground"
            )}
          >
            {isPreviewing
              ? `Previewing ${previewed.name}`
              : `${selected.name} · Selected`}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {SWATCHES.map((swatch) => {
          const isSelected = swatch.id === selected.id
          const isSaving = saving === swatch.id
          return (
            <button
              key={swatch.id}
              type="button"
              disabled={saving !== null}
              aria-pressed={isSelected}
              onClick={() => handleSelect(swatch)}
              onMouseEnter={() => setHovered(swatch.id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(swatch.id)}
              onBlur={() => setHovered(null)}
              className={cn(
                "group flex flex-col items-start gap-2.5 rounded-lg border-2 p-3 text-left transition-colors active:translate-y-px",
                "disabled:pointer-events-none disabled:opacity-50",
                isSelected
                  ? "border-foreground bg-card"
                  : "border-transparent hover:border-border hover:bg-card"
              )}
            >
              <span
                className={cn(
                  "flex h-11 w-11 items-center justify-center transition-transform duration-150",
                  !isSelected && "group-hover:scale-110 group-hover:shadow-sm",
                  !swatch.hex && "border"
                )}
                style={{ background: swatch.hex ?? NONE_HATCH }}
              >
                {isSaving ? (
                  <Loader2
                    className="h-5 w-5 animate-spin"
                    style={{ color: swatch.foreground ?? "var(--muted-foreground)" }}
                  />
                ) : isSelected ? (
                  <Check
                    className="h-5 w-5 animate-in zoom-in-50 duration-200"
                    strokeWidth={3}
                    style={{ color: swatch.foreground ?? "var(--foreground)" }}
                  />
                ) : !swatch.hex ? (
                  <Ban className="h-4 w-4 text-muted-foreground" />
                ) : null}
              </span>
              <span className="flex flex-col gap-0.5">
                <span
                  className={cn(
                    "text-[13px] leading-tight",
                    isSelected ? "font-bold text-foreground" : "text-foreground"
                  )}
                >
                  {swatch.name}
                </span>
                {/* The hex is reference detail, not scanning detail — revealed only for
                    the row you're actually looking at, per the spec's metaOpacity. */}
                <span
                  className={cn(
                    "text-[11px] font-medium uppercase tracking-wide text-muted-foreground transition-opacity",
                    isSelected || hovered === swatch.id ? "opacity-100" : "opacity-0"
                  )}
                >
                  {swatch.hex ?? "No accent"}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
