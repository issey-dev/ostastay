"use client"

import { useState } from "react"
import { INFO_THEME_COOKIE, INFO_THEME_MAX_AGE } from "./theme"

/**
 * Light/dark switch for the marketing pages.
 *
 * DELIBERATELY NOT the app's dark-mode provider. That one persists under `theme-mode` and
 * drives the signed-in dashboard; a prospect flipping the marketing site to light should
 * not silently rewrite an operator's product preference, or vice versa. This keeps its own
 * key and the two never collide.
 *
 * DARK IS THE DEFAULT, not the system preference. branding-guide presents the brand on
 * Obsidian and the guide document itself is dark — that is the intended first impression.
 * A stored choice always wins over it.
 *
 * A COOKIE, NOT localStorage. The preference has to be known before the first paint or
 * the page flashes dark on its way to light. The usual trick is a synchronous inline
 * script, but React drops inline scripts rendered from a nested layout (only the root
 * layout's <head> survives) — tried, and it silently never persisted. A cookie is instead
 * read by the server layout, which is force-dynamic anyway, and the class ships in the
 * first byte of HTML. It also means the stored preference is honoured with JS disabled.
 */
export function InfoThemeToggle({ initialIsLight }: { initialIsLight: boolean }) {
  // Seeded from the server's own answer rather than read back out of the DOM in an
  // effect. The layout already resolved the cookie to render the theme class, so passing
  // it down means server and client agree on the first render, the accessible name is
  // correct immediately, and there is no setState-in-effect round trip.
  const [isLight, setIsLight] = useState(initialIsLight)

  const toggle = () => {
    const page = document.querySelector(".info-page")
    if (!page) return
    const next = !page.classList.contains("info-light")
    page.classList.toggle("info-light", next)
    // Lax rather than Strict: this must survive arriving from an external link, and it
    // carries a colour preference, nothing sensitive.
    document.cookie = `${INFO_THEME_COOKIE}=${next ? "light" : "dark"}; path=/; max-age=${INFO_THEME_MAX_AGE}; SameSite=Lax`
    setIsLight(next)
  }

  const label = isLight ? "Switch to dark theme" : "Switch to light theme"

  return (
    <button type="button" className="info-theme-btn" onClick={toggle} aria-label={label} title={label}>
      {/* Sun — shown on the dark page, because the icon advertises what you switch TO. */}
      <svg className="icon-to-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <circle cx="12" cy="12" r="4.2" />
        <path
          strokeLinecap="round"
          d="M12 2.4v2.3M12 19.3v2.3M4.4 12H2.1M21.9 12h-2.3M6.3 6.3 4.7 4.7M19.3 19.3l-1.6-1.6M6.3 17.7l-1.6 1.6M19.3 4.7l-1.6 1.6"
        />
      </svg>
      {/* Moon — shown on the light page. */}
      <svg className="icon-to-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path strokeLinejoin="round" d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5a8.6 8.6 0 1 0 10.7 10.7Z" />
      </svg>
    </button>
  )
}
