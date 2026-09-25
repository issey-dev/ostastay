"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { PRODUCTS } from "./products"

/**
 * The marketing nav. A client component solely so the current page can carry
 * aria-current — which is what drives both the crimson underscore in info.css and the
 * announcement for a screen reader.
 *
 * Below 1040px the inline nav is hidden (info.css) and a menu button takes its place: a
 * disclosure that drops a full-width panel under the top bar with the same links. Both
 * are always rendered; CSS decides which one shows, so there is no layout flash.
 */
export function InfoNav() {
  const pathname = usePathname()

  return (
    <>
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
      <InfoMobileMenu pathname={pathname} />
    </>
  )
}

function InfoMobileMenu({ pathname }: { pathname: string | null }) {
  const [open, setOpen] = useState(false)
  const [openedAt, setOpenedAt] = useState(pathname)
  const rootRef = useRef<HTMLDivElement>(null)

  // Navigating closes the menu (the layout — and this component — persist across pages).
  if (open && openedAt !== pathname) {
    setOpen(false)
    setOpenedAt(pathname)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onPointer)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("pointerdown", onPointer)
    }
  }, [open])

  return (
    <div className="info-menu" ref={rootRef}>
      <button
        type="button"
        className="info-menu-btn"
        aria-expanded={open}
        aria-controls="info-menu-panel"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => {
          setOpenedAt(pathname)
          setOpen((o) => !o)
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      <nav id="info-menu-panel" className="info-menu-panel" data-open={open} aria-label="Site">
        <Link href="/info" aria-current={pathname === "/info" ? "page" : undefined} onClick={() => setOpen(false)}>
          <span>Overview</span>
        </Link>
        {PRODUCTS.map((p) => {
          const href = `/info/${p.slug}`
          return (
            <Link key={p.slug} href={href} aria-current={pathname === href ? "page" : undefined} onClick={() => setOpen(false)}>
              <span>{p.name}</span>
              <span className="info-menu-role">{p.role}</span>
            </Link>
          )
        })}
        <Link href="/info#contact" onClick={() => setOpen(false)}>
          <span>Contact</span>
        </Link>
      </nav>
    </div>
  )
}
