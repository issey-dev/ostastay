"use client"

import { useProperty } from "@/components/providers/property-provider"

// Injects the active property's banner color as a single CSS custom property
// (`--property-accent`) scoped to the dashboard content area, so the accent can be
// consumed purely in CSS by shared components (currently the `Card` left edge — see
// globals.css `.property-accent-scope [data-slot="card"]`) without every one of them
// needing the PropertyProvider hook. Reacts live to the property switcher.
//
// When the property has no banner color, the scope class and variable are omitted
// entirely, so nothing gets an accent (fully monochromatic). Dialogs/popovers portal
// outside this wrapper, so they intentionally never inherit the accent.
export function PropertyAccentScope({ children }: { children: React.ReactNode }) {
  const { currentProperty } = useProperty()
  const accent = currentProperty?.bannerColor

  if (!accent) return <>{children}</>

  return (
    <div className="property-accent-scope" style={{ "--property-accent": accent } as React.CSSProperties}>
      {children}
    </div>
  )
}
