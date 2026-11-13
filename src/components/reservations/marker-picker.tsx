"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { MARKER_COLORS, MARKER_COLOR_KEYS, MARKER_ICONS, isMarkerColor, isMarkerIcon, type MarkerColor, type MarkerIcon } from "@/lib/booking-markers"
import { MarkerIconView } from "@/components/reservations/booking-marker"
import { cn } from "@/lib/utils"

// Picking a booking marker (Agent Portal plan A-22): an icon from the app's set and one of
// the twelve colours, in a modal with a live preview of how the booking will look on the
// Tape Chart. Used on Source profiles and in the Hub marker editor.

export const MARKER_ICON_LABELS: Record<MarkerIcon, string> = {
  Briefcase: "Briefcase",
  Clock: "Clock",
  Building2: "Building",
  Users: "People",
  Globe: "Globe",
  Link2: "Link",
  AlertTriangle: "Warning",
  Star: "Star",
  Crown: "Crown",
  Award: "Award",
  Heart: "Heart",
  Gift: "Gift",
  Flag: "Flag",
  Tag: "Tag",
  Plane: "Plane",
  Ship: "Boat",
  Sun: "Sun",
  Sparkles: "Sparkles",
}

/** A Tape Chart booking bar as it will appear, with this marker. */
export function MarkerBarPreview({
  icon,
  color,
  guest = "Guest name",
  reference = "#000123",
  tentative,
  className,
}: {
  icon: MarkerIcon | null
  color: MarkerColor | null
  guest?: string
  reference?: string
  tentative?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "relative flex h-12 w-48 flex-col justify-between overflow-hidden border border-border/60 border-l-[3px] border-l-info bg-info-muted px-1.5 py-1 text-foreground",
        className
      )}
      style={
        tentative
          ? { backgroundImage: "repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in oklab, currentColor 14%, transparent) 6px 8px)" }
          : undefined
      }
      aria-hidden
    >
      {color && <span className={cn("absolute inset-y-0 right-0 w-[3px]", MARKER_COLORS[color].dot)} />}
      <span className="flex min-w-0 items-center gap-1 text-xs font-bold leading-tight">
        {icon && color && (
          <span className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded-sm", MARKER_COLORS[color].chip)}>
            <MarkerIconView name={icon} className="size-3" />
          </span>
        )}
        <span className="truncate">{guest}</span>
      </span>
      <span className="truncate font-mono text-[10px] text-muted-foreground">{reference}</span>
    </div>
  )
}

/** The closed field: the preview bar and a Change button that opens the picker. */
export function MarkerPickerField({
  icon,
  color,
  onChange,
  disabled,
  title = "Tape Chart marker",
  guest,
  emptyHint = "Default marker",
  allowClear = true,
}: {
  icon: string | null | undefined
  color: string | null | undefined
  onChange: (next: { icon: MarkerIcon | null; color: MarkerColor | null }) => void
  disabled?: boolean
  title?: string
  guest?: string
  emptyHint?: string
  allowClear?: boolean
}) {
  const [open, setOpen] = useState(false)
  const i = isMarkerIcon(icon) ? icon : null
  const c = isMarkerColor(color) ? color : null
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {i || c ? (
          <MarkerBarPreview icon={i ?? "Briefcase"} color={c} guest={guest} />
        ) : (
          <span className="text-sm text-muted-foreground">{emptyHint}</span>
        )}
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
          {i || c ? "Change" : "Choose"}
        </Button>
      </div>
      <MarkerPickerDialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        guest={guest}
        allowClear={allowClear}
        icon={i}
        color={c}
        onSave={(next) => {
          onChange(next)
          setOpen(false)
        }}
      />
    </>
  )
}

export function MarkerPickerDialog({
  open,
  onClose,
  onSave,
  icon,
  color,
  title,
  guest,
  allowClear = true,
}: {
  open: boolean
  onClose: () => void
  onSave: (next: { icon: MarkerIcon | null; color: MarkerColor | null }) => void
  icon: MarkerIcon | null
  color: MarkerColor | null
  title: string
  guest?: string
  allowClear?: boolean
}) {
  const [pickIcon, setPickIcon] = useState<MarkerIcon>(icon ?? "Briefcase")
  const [pickColor, setPickColor] = useState<MarkerColor>(color ?? "sky")
  useEffect(() => {
    if (!open) return
    setPickIcon(icon ?? "Briefcase")
    setPickColor(color ?? "sky")
  }, [open, icon, color])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" mobile="sheet">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            The icon and colour shown on this booking&rsquo;s bar on the Tape Chart and next to it in the lists. The bar&rsquo;s own
            fill still shows its status.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-1 md:grid-cols-[1fr_auto]">
          <div className="space-y-4">
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Icon</legend>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6" role="radiogroup" aria-label="Icon">
                {MARKER_ICONS.map((ic) => {
                  const on = ic === pickIcon
                  return (
                    <button
                      key={ic}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setPickIcon(ic)}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-md border p-2 text-[11px] transition-colors",
                        on ? "border-foreground bg-muted font-medium" : "border-border text-muted-foreground hover:bg-muted/60"
                      )}
                    >
                      <span className={cn("inline-flex size-7 items-center justify-center rounded-md", MARKER_COLORS[pickColor].chip)}>
                        <MarkerIconView name={ic} className="size-4" />
                      </span>
                      {MARKER_ICON_LABELS[ic]}
                    </button>
                  )
                })}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Colour</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
                {MARKER_COLOR_KEYS.map((c) => {
                  const on = c === pickColor
                  return (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={MARKER_COLORS[c].label}
                      title={MARKER_COLORS[c].label}
                      onClick={() => setPickColor(c)}
                      className={cn(
                        "size-8 rounded-full ring-offset-2 ring-offset-background transition-shadow",
                        MARKER_COLORS[c].dot,
                        on && "ring-2 ring-foreground"
                      )}
                    />
                  )
                })}
              </div>
            </fieldset>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Preview</p>
            <div className="space-y-2 rounded-md border border-border bg-card p-3">
              <p className="text-[11px] text-muted-foreground">Confirmed booking</p>
              <MarkerBarPreview icon={pickIcon} color={pickColor} guest={guest} />
              <p className="text-[11px] text-muted-foreground">Tentative booking (hatched)</p>
              <MarkerBarPreview icon={pickIcon} color={pickColor} guest={guest} tentative />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          {allowClear && (
            <Button type="button" variant="ghost" className="mr-auto" onClick={() => onSave({ icon: null, color: null })}>
              Use the default
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={() => onSave({ icon: pickIcon, color: pickColor })}>Use this marker</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
