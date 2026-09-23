"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { DOC_SECTIONS } from "./nav"

export const DOCS_MENU_ID = "docs-menu"

/**
 * The portal's navigation. A client component only for aria-current; on a phone it is
 * opened by the CSS-only checkbox in the layout, and closed again here on navigation.
 */
export function DocsSidebar() {
  const pathname = usePathname()
  const close = () => {
    const box = document.getElementById(DOCS_MENU_ID) as HTMLInputElement | null
    if (box) box.checked = false
  }
  return (
    <nav className="docs-sidebar" aria-label="Documentation">
      {DOC_SECTIONS.map((section) => (
        <div key={section.title}>
          <h4>{section.title}</h4>
          {section.links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={pathname === l.href ? "page" : undefined} onClick={close}>
              {l.title}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  )
}
