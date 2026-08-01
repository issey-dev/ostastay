/**
 * WCAG 2.4.1 (Bypass Blocks). Every authenticated shell in this app — dashboard, hub and
 * the Osta console — renders a full navigation sidebar ahead of <main>, so a keyboard or
 * screen-reader user otherwise tabs through every nav item on every page before reaching
 * the content they came for.
 *
 * Must be the FIRST focusable element in the shell, so it is rendered before the sidebar,
 * not merely positioned above it.
 *
 * Hidden until focused: `sr-only` keeps it out of the visual layout for pointer users,
 * `focus:not-sr-only` brings it back on keyboard focus. It is deliberately NOT
 * `display: none` — that would take it out of the tab order entirely and defeat the point.
 *
 * z-[var(--z-toast)] because it has to clear the sticky header (--z-sticky) and the support
 * banner (--z-banner) it visually overlaps when revealed; see theme.css for the scale.
 */
export function SkipToContent({ targetId = "main-content" }: { targetId?: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only rounded-none focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[var(--z-toast)] focus:flex focus:items-center focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-elevation-3 focus:outline-none focus:ring-3 focus:ring-ring/50"
    >
      Skip to main content
    </a>
  )
}
