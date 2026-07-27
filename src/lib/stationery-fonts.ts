// Single source of truth for the stationery typeface choices and their Tailwind font
// class mapping. Previously duplicated three times (the Stationaries manager's
// FONT_STYLES, print-document-shell's FONT_CLASSES, and an inline map in the
// confirmation-letter page) which could drift apart. The font is chosen per-property in
// Controls > General > Appearance (Property.stationeryFont) and inherited by every
// printed stationary.

export const DEFAULT_STATIONERY_FONT = "Geist"

export type StationeryFontOption = {
  value: string
  label: string
  // Tailwind font-family utility this font maps to.
  className: string
}

export const STATIONERY_FONTS: StationeryFontOption[] = [
  { value: "Geist", label: "Geist (Default)", className: "font-sans" },
  { value: "Inter", label: "Inter (Clean)", className: "font-sans" },
  { value: "Roboto", label: "Roboto (Sleek)", className: "font-sans" },
  { value: "Georgia", label: "Georgia (Classic Serif)", className: "font-serif" },
  { value: "Courier", label: "Courier (Retro Mono)", className: "font-mono" },
]

const FONT_CLASS_BY_VALUE: Record<string, string> = Object.fromEntries(
  STATIONERY_FONTS.map((f) => [f.value, f.className])
)

// Resolve a stored font name to its Tailwind class, defaulting to sans for null/unknown.
export function resolveStationeryFontClass(font: string | null | undefined): string {
  return (font && FONT_CLASS_BY_VALUE[font]) || "font-sans"
}
