/**
 * The Uppsolut marks, per `branding-guide/uppsolut_brand_guidelines.html` (v1.1).
 *
 * WHY THESE ARE REBUILT RATHER THAN IMPORTED. The brand kit ships finished SVGs in
 * `branding-guide/uppsolut-brand-assets/`, but every wordmark file pulls Inter over the
 * network with `@import url('https://fonts.googleapis.com/...')` inside the SVG. Used in
 * this app that would (a) fetch a font the app already self-hosts via next/font, and
 * (b) be blocked outright wherever a strict style/font-src CSP applies. Rendering the
 * same geometry as inline SVG here means the mark uses the Inter that is already loaded.
 *
 * The kit's numbers are reproduced exactly — font sizes, `textLength` width-locks and
 * baselines are lifted from the source files, so these render identically to the
 * marketing assets. Do not "clean up" the odd values (14.6, -1, 216); they are the
 * kit's own measurements.
 *
 * Guide rules encoded here, none of which are safe to change locally (§01, §06, §08):
 *   - UPP is Inter 900 and SOLUT is Inter 300. Never equalize or swap the weights.
 *   - Tracking comes from the width-lock (`textLength` + `lengthAdjust="spacing"`),
 *     never from manual letter-spacing on the wordmark.
 *   - The subline is locked to the wordmark's width and is dropped first at small sizes.
 *   - In the stacked lockup the module name may never grow wider than the UPPSOLUT
 *     anchor above it.
 */

import { cn } from "@/lib/utils"

/** Inter, as loaded by next/font in the root layout — never a bare "Inter" family name. */
const BRAND_FONT = "var(--font-inter), 'Helvetica Neue', Helvetica, Arial, sans-serif"

const TAGLINE = "BUSINESS OPERATING ENGINE"

type MarkProps = {
  className?: string
  /** Accessible name. Pass null for decorative marks that sit beside real text. */
  title?: string | null
}

/**
 * The horizontal UPPSOLUT wordmark.
 *
 * Colour follows `currentColor`, so the mark inherits whatever it is placed on:
 * Obsidian on a light canvas, Platinum on a dark one — the guide's two primary
 * colorways — without the call site choosing a hex.
 */
export function UppsolutWordmark({
  className,
  title = "Uppsolut",
  showTagline = false,
}: MarkProps & { showTagline?: boolean }) {
  // 96 tall with the tagline, 72 without — trimming the box rather than leaving dead
  // space keeps the mark optically centred when a flex parent centres it.
  const viewBoxHeight = showTagline ? 96 : 72
  return (
    <svg
      viewBox={`0 0 560 ${viewBoxHeight}`}
      className={className}
      role={title ? "img" : "presentation"}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
      fill="currentColor"
    >
      {title ? <title>{title}</title> : null}
      <text x="0" y="58" fontFamily={BRAND_FONT} fontSize="66" textLength="560" lengthAdjust="spacing">
        <tspan fontWeight="900">UPP</tspan>
        <tspan fontWeight="300">SOLUT</tspan>
      </text>
      {showTagline ? (
        <text
          x="0"
          y="86"
          fontFamily={BRAND_FONT}
          fontWeight="300"
          fontSize="14.6"
          textLength="560"
          lengthAdjust="spacing"
          opacity="0.72"
        >
          {TAGLINE}
        </text>
      ) : null}
    </svg>
  )
}

/**
 * The stacked sub-brand lockup — UPPSOLUT anchored on top, the module name below at
 * ~2.4x cap-height, sharing the same left edge (guide §06).
 *
 * The module colour is `--primary`, i.e. Crimson OS. The guide's letter says "Crimson on
 * light / Platinum on dark", and the reason it switches is that #8B0000 is illegible on
 * Obsidian — but this app's dark theme already lifts `--primary` to a brighter crimson
 * that clears 4.5:1 there. Binding to the token keeps the module in the brand hue in both
 * modes and satisfies the legibility problem the Platinum rule exists to solve.
 */
export function UppsolutStayLockup({ className, title = "Uppsolut Stay", module = "STAY" }: MarkProps & { module?: string }) {
  return (
    <svg
      viewBox="0 0 216 128"
      className={className}
      role={title ? "img" : "presentation"}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      {/* Anchor: defines 1W (216) and the left edge for the whole lockup. */}
      <text
        x="0"
        y="34"
        fontFamily={BRAND_FONT}
        fontSize="26"
        textLength="216"
        lengthAdjust="spacing"
        fill="currentColor"
      >
        <tspan fontWeight="900">UPP</tspan>
        <tspan fontWeight="300">SOLUT</tspan>
      </text>
      {/* Module. textLength is deliberately absent: the guide caps the module at 1W and
          says to REDUCE it until it fits rather than stretch it to the anchor's width. */}
      <text
        x="-1"
        y="120"
        fontFamily={BRAND_FONT}
        fontWeight="900"
        fontSize="72"
        letterSpacing="2"
        fill="var(--primary)"
      >
        {module}
      </text>
    </svg>
  )
}

/**
 * The "U" icon tile.
 *
 * The glyph is an OUTLINED path, not live text — extracted from the real Inter Black "U"
 * by `branding-guide/uppsolut-brand-assets/favicon/bake-inter-favicons.py`, which is the
 * same source the shipped favicons were baked from. That is what guarantees the icon and
 * the wordmark's U are the same shape with zero font dependency (guide's icon note).
 *
 * `tile={false}` drops the crimson plate and paints the bare glyph in `currentColor`.
 */
export function UppsolutIcon({ className, title = "Uppsolut", tile = true }: MarkProps & { tile?: boolean }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      role={title ? "img" : "presentation"}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      {tile ? <rect width="512" height="512" rx="115" fill="var(--primary)" /> : null}
      <path
        transform="translate(108.984 402.419) scale(0.19894 -0.19894)"
        d="M738 -18Q546 -18 401.5 49.5Q257 117 176.5 241.5Q96 366 96 536V1490H500V570Q500 500 531.0 446.5Q562 393 615.5 362.5Q669 332 738 332Q808 332 862.0 362.5Q916 393 947.0 446.5Q978 500 978 570V1490H1382V536Q1382 366 1301.0 241.5Q1220 117 1075.0 49.5Q930 -18 738 -18Z"
        fill={tile ? "var(--primary-foreground)" : "currentColor"}
      />
    </svg>
  )
}

/**
 * Icon + wordmark on one line — the compact lockup for app headers and nav rails, where
 * the stacked version is too tall. Not a kit asset: the kit covers the marks themselves,
 * not this arrangement, so the spacing here is ours.
 */
export function UppsolutInlineLockup({ className, title = "Uppsolut Stay" }: MarkProps) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <UppsolutIcon className="h-7 w-7 shrink-0" title={title} />
      <span className="flex flex-col leading-none">
        <UppsolutWordmark className="h-[13px] w-auto" title={null} />
        <span className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] opacity-70">Stay</span>
      </span>
    </span>
  )
}
