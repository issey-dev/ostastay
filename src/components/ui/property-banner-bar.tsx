"use client"

import { useProperty } from "@/components/providers/property-provider"

// A thin accent line at the very top of every dashboard page — the property's own
// customizable banner (Controls > General > Appearance), distinct per property, never
// shared across an enterprise's other properties. Renders nothing until a property sets
// a color (monochromatic default). Reacts live to the property switcher since it reads
// from the same client-side PropertyProvider context, not a server-rendered value.
export function PropertyBannerBar() {
  const { currentProperty } = useProperty()

  if (!currentProperty?.bannerColor) return null

  return (
    <div
      data-slot="property-banner-bar"
      className="h-1 w-full shrink-0"
      style={{ backgroundColor: currentProperty.bannerColor }}
    />
  )
}
