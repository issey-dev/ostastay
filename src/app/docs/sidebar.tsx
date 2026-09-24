"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { DOC_AREAS, OPENAPI_URL, areaFor } from "./nav"

export const DOCS_MENU_ID = "docs-menu"

const closeMenu = () => {
  const box = document.getElementById(DOCS_MENU_ID) as HTMLInputElement | null
  if (box) box.checked = false
}

/**
 * The portal's navigation: the list of areas, then the current area's table of contents.
 * A client component only for the pathname; on a phone it is opened by the CSS-only
 * checkbox in the layout, and closed again here on navigation.
 */
export function DocsSidebar() {
  const pathname = usePathname()
  const area = areaFor(pathname)
  return (
    <nav className="docs-sidebar" aria-label="Documentation">
      {/* Inside an area the header tabs already switch areas, so on a wide screen this
          block shows only on the portal home; on a phone it always leads the menu. */}
      <div className="docs-sidebar-areas" data-in-area={area ? "" : undefined}>
        <h4>Documentation</h4>
        {DOC_AREAS.map((a) => (
          <Link key={a.key} href={a.href} aria-current={area?.key === a.key ? "true" : undefined} onClick={closeMenu}>
            {a.title}
          </Link>
        ))}
      </div>
      {area?.sections.map((section) => (
        <div key={section.title}>
          <h4>{section.title}</h4>
          {section.links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={pathname === l.href ? "page" : undefined} onClick={closeMenu}>
              {l.title}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  )
}

/** The header's area tabs and the current area's downloads. */
export function DocsHeaderNav() {
  const area = areaFor(usePathname())
  return (
    <>
      <nav className="docs-areas" aria-label="Documentation areas">
        {DOC_AREAS.map((a) => (
          <Link key={a.key} href={a.href} aria-current={area?.key === a.key ? "true" : undefined}>
            {a.title}
          </Link>
        ))}
      </nav>
      <nav className="docs-header-links" aria-label="Downloads">
        {area?.key === "api" && <a href={OPENAPI_URL}>OpenAPI</a>}
        {area && <a href={area.pdf.url}>PDF</a>}
        <Link href="/login">Sign in</Link>
      </nav>
    </>
  )
}
