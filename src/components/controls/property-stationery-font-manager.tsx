"use client"

import { useState } from "react"
import { Check, Loader2 } from "@/components/icons"
import { usePropertyValue, type HubPropertyDetail } from "@/components/hub/property-detail"
import { STATIONERY_FONTS, DEFAULT_STATIONERY_FONT, resolveStationeryFontClass } from "@/lib/stationery-fonts"
import { cn } from "@/lib/utils"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"
import { InlineLoading } from "@/components/ui/inline-loading"
import { SavedTick, useSavedFlash } from "@/components/controls/save-status"

// Sets the CURRENT property's stationery typeface — inherited by every printed document
// (Invoices, Receipts, Confirmation Letters, Registration Cards, Statements). Lives in the
// Appearance card next to the banner-colour picker so a property's whole look (accent +
// font) is chosen in one place. Persists to Property.stationeryFont via the same
// /api/properties/[id] PUT the banner picker uses; the two never clobber each other because
// each sends only its own field (undefined elsewhere leaves the column unchanged).
export function PropertyStationeryFontManager({ property }: { property: HubPropertyDetail }) {
  const [currentProperty, applySaved] = usePropertyValue(property)
  const [saving, setSaving] = useState<string | null>(null)
  const [savedShown, flashSaved] = useSavedFlash()

  if (!currentProperty) {
    return <InlineLoading className="py-8" label="Loading property" />
  }

  const selected = currentProperty.stationeryFont ?? DEFAULT_STATIONERY_FONT

  const handleSelect = async (font: string) => {
    if (font === selected) return
    setSaving(font)
    try {
      const res = await fetch(`/api/properties/${currentProperty.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stationeryFont: font }),
      })
      if (res.ok) {
        applySaved({ stationeryFont: font })
        flashSaved()
      } else {
        toast.error(await apiError(res, "Couldn't save the stationery font. Try again."))
      }
    } catch {
      toast.error("Couldn't save the stationery font. Try again.")
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="space-y-5 border-t border-border pt-6">
      <div>
        <h3 className="flex items-center gap-3 text-sm font-semibold text-foreground">
          Stationery font
          <SavedTick show={savedShown} />
        </h3>
        <p className="text-sm text-muted-foreground max-w-[60ch]">
          The typeface used on every printed document for{" "}
          <strong className="text-foreground">{currentProperty.name}</strong> — invoices, receipts, confirmation
          letters, registration cards, and statements all inherit it.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {STATIONERY_FONTS.map((font) => {
          const isSelected = font.value === selected
          const isSaving = saving === font.value
          return (
            <button
              key={font.value}
              type="button"
              disabled={saving !== null}
              aria-pressed={isSelected}
              onClick={() => handleSelect(font.value)}
              className={cn(
                "group flex flex-col items-start gap-2 rounded-lg border-2 p-3 text-left transition-colors active:translate-y-px",
                "disabled:pointer-events-none disabled:opacity-50",
                isSelected ? "border-foreground bg-card" : "border-transparent hover:border-border hover:bg-card"
              )}
            >
              {/* A live glyph sample so the choice is judged by how it actually reads. */}
              <span
                className={cn(
                  "flex h-11 w-full items-center justify-center rounded border bg-background text-lg leading-none",
                  resolveStationeryFontClass(font.value)
                )}
              >
                {isSaving ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : (
                  <span className="text-foreground">Ag</span>
                )}
              </span>
              <span className="flex items-center gap-1.5">
                {isSelected && <Check className="h-3.5 w-3.5 text-foreground" strokeWidth={3} />}
                <span className={cn("text-[13px] leading-tight", isSelected ? "font-bold text-foreground" : "text-foreground")}>
                  {font.label}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
