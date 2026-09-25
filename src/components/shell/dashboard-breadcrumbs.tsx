"use client"

import Link from "next/link"
import { useParams, usePathname } from "next/navigation"
import { NAV_GROUPS } from "@/components/app-sidebar-nav.config"

// "Reservations › VM4224" above a detail page's title (DESKTOP_PLAN §2.1). The parent is the
// sidebar item the URL sits under — the longest nav url the path starts with — so a new page
// gets its crumb by living under a nav entry, the same rule as HubBreadcrumbs. Renders nothing
// on a top-level page (the sidebar already says where you are).
export function DashboardBreadcrumbs({ current, parents = [] }: { current?: string | null; parents?: { label: string; href: string }[] }) {
  const pathname = usePathname()
  const { slug } = useParams<{ slug: string }>()
  const prefix = `/e/${slug}`
  const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname
  const item = NAV_GROUPS.flatMap((g) => g.items)
    .filter((i) => rest === i.url || rest.startsWith(`${i.url}/`))
    .sort((a, b) => b.url.length - a.url.length)[0]
  if (!item || rest === item.url) return null

  const crumbs = [{ label: item.title, href: `${prefix}${item.url}` }, ...parents]
  return (
    <nav aria-label="Breadcrumb" className="mb-1 max-md:hidden flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
      {crumbs.map((c) => (
        <span key={c.href} className="inline-flex items-center gap-1">
          <Link href={c.href} className="hover:text-foreground hover:underline">
            {c.label}
          </Link>
          <span aria-hidden>›</span>
        </span>
      ))}
      {current && <span className="truncate text-foreground">{current}</span>}
    </nav>
  )
}
