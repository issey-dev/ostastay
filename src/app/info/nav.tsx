"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { PRODUCTS } from "./products"

/**
 * The marketing nav. A client component solely so the current page can carry
 * aria-current — which is what drives both the crimson underscore in info.css and the
 * announcement for a screen reader.
 */
export function InfoNav() {
  const pathname = usePathname()

  return (
    <nav className="info-top-nav" aria-label="Products">
      {PRODUCTS.map((p) => {
        const href = `/info/${p.slug}`
        const current = pathname === href
        return (
          <Link key={p.slug} href={href} aria-current={current ? "page" : undefined}>
            {p.mark}
          </Link>
        )
      })}
      <Link href="/info#contact">Contact</Link>
    </nav>
  )
}
