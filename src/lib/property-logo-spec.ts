// The logo's fixed shape (owner, 2026-09-24) — shared by the browser cropper and the server
// check (src/lib/property-logo.ts), so it has no server imports. 3:2 landscape, exported at
// 900 × 600: about 2–3 inches of print-sharp (300 dpi) logo, well above the ~1.5–2 inches
// documents show it at.
export const LOGO_ASPECT = 3 / 2
export const LOGO_WIDTH = 900
export const LOGO_HEIGHT = 600
// A flat-colour logo at 900 × 600 is typically 30–150 KB; the cap only has to admit the
// worst case (a photo-like logo, ~2.2 MB of uncompressed RGBA) — the size is fixed anyway.
export const MAX_LOGO_BYTES = 2.5 * 1024 * 1024
/** What the uploader accepts as its source image (it is re-encoded as PNG). */
export const MAX_LOGO_SOURCE_BYTES = 10 * 1024 * 1024
