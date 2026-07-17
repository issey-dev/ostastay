import * as React from "react"

// Matches Tailwind's default `md`/`lg` breakpoints — the app's three device tiers are
// defined once here, not as scattered raw pixel values in components.
const TABLET_BREAKPOINT = 768
const DESKTOP_BREAKPOINT = 1024

export type DeviceTier = "mobile" | "tablet" | "desktop"

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${TABLET_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < TABLET_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < TABLET_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

// The three-tier equivalent of useIsMobile() — for layout decisions that need to
// distinguish tablet from desktop (not just mobile vs. everything else).
export function useDeviceTier(): DeviceTier | undefined {
  const [tier, setTier] = React.useState<DeviceTier | undefined>(undefined)

  React.useEffect(() => {
    const compute = (): DeviceTier => {
      const width = window.innerWidth
      if (width < TABLET_BREAKPOINT) return "mobile"
      if (width < DESKTOP_BREAKPOINT) return "tablet"
      return "desktop"
    }
    const onChange = () => setTier(compute())
    const mqlTablet = window.matchMedia(`(max-width: ${TABLET_BREAKPOINT - 1}px)`)
    const mqlDesktop = window.matchMedia(`(max-width: ${DESKTOP_BREAKPOINT - 1}px)`)
    mqlTablet.addEventListener("change", onChange)
    mqlDesktop.addEventListener("change", onChange)
    setTier(compute())
    return () => {
      mqlTablet.removeEventListener("change", onChange)
      mqlDesktop.removeEventListener("change", onChange)
    }
  }, [])

  return tier
}
