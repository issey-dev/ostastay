/**
 * Colour-theme constants for the marketing pages.
 *
 * DELIBERATELY A NEUTRAL MODULE — no "use client" directive. These values are needed by
 * BOTH the server layout (which reads the cookie to render the right theme in the first
 * byte of HTML) and the client toggle (which writes it). Exporting them from the toggle
 * component instead looked fine and type-checked, but a Server Component importing a
 * value out of a "use client" module receives a client-reference proxy rather than the
 * value — so `cookies().get(INFO_THEME_COOKIE)` was looking up a proxy object, always
 * missed, and the page silently rendered dark no matter what the visitor had chosen.
 *
 * It fails QUIETLY, which is what makes it worth a comment: the same mistake with a
 * function throws "Attempted to call X from the server but X is on the client" (see
 * src/lib/initials.ts, and the same note on NAV_MODULES in
 * src/components/app-sidebar-nav.config.ts), but with a plain string you get no error at
 * all — just behaviour that never works.
 */

/** Cookie holding the visitor's colour choice. Values: "light" | "dark". */
export const INFO_THEME_COOKIE = "uppsolut-info-theme"

/** One year — a colour preference is not worth re-asking on every visit. */
export const INFO_THEME_MAX_AGE = 60 * 60 * 24 * 365
