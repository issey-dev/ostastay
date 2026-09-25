"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

// Jump links for a long Hub setup page (DESKTOP_PLAN §2.4 — Finance alone is ~3,000px with five
// sections). It reads the page's ControlsCard sections (data-section) after render, so a page
// gets links just by using ControlsCard; nothing to list by hand. Only shown on desktop and
// only when there are 3+ sections — a short page needs no navigation. Highlights the section
// in view.
export function HubSectionNav() {
  const pathname = usePathname()
  const [sections, setSections] = useState<{ id: string; title: string }[]>([])
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    // Sections can mount after data loads — look again briefly.
    const read = () =>
      setSections(
        Array.from(document.querySelectorAll<HTMLElement>("#main-content [data-section]")).map((el) => ({
          id: el.id,
          title: el.dataset.section ?? "",
        }))
      )
    read()
    const t = setTimeout(read, 800)
    return () => clearTimeout(t)
  }, [pathname])

  useEffect(() => {
    if (sections.length < 3) return
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: "-80px 0px -60% 0px" }
    )
    sections.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [sections])

  if (sections.length < 3) return null
  return (
    <nav
      aria-label="On this page"
      className="sticky top-16 z-[var(--z-sticky)] -mx-1 mb-2 flex flex-wrap gap-1 bg-background/90 px-1 py-2 backdrop-blur-sm max-md:hidden"
    >
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className={cn(
            "px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground",
            active === s.id && "bg-muted text-foreground"
          )}
        >
          {s.title}
        </a>
      ))}
    </nav>
  )
}
