"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Fragment } from "react"
import { ENTERPRISE_NAV, PROPERTY_NAV, enterpriseHref, propertyHref, type HubNavItem } from "@/components/hub/hub-nav"

// Where you are in the Hub, under the header: "Overview", "Enterprise › People",
// "Controls › Finance" or "Channel Manager › Mapping". Built from the same nav config as the sidebar,
// so a new page gets its crumb by being added there. Which property "Controls" belongs to
// is named by the property band just below.

type Crumb = { label: string; href?: string }

// The nav item a sub-path belongs to — the longest item path it starts with.
function matchItem(items: HubNavItem[], rest: string): HubNavItem | undefined {
  return items
    .filter((i) => i.path !== "" && (rest === i.path || rest.startsWith(`${i.path}/`)))
    .sort((a, b) => b.path.length - a.path.length)[0]
}

// A child item's parent: the item whose path its own path extends (channel-manager/mapping
// → channel-manager).
function parentOf(items: HubNavItem[], item: HubNavItem): HubNavItem | undefined {
  if (!item.child) return undefined
  const parentPath = item.path.split("/").slice(0, -1).join("/")
  return items.find((i) => i.path === parentPath)
}

function crumbsFor(pathname: string, slug: string): Crumb[] {
  const root = `/e/${slug}/hub`
  if (!pathname.startsWith(root)) return []
  const rest = pathname.slice(root.length).replace(/^\/+|\/+$/g, "")
  if (rest === "") return [{ label: "Overview" }]

  const [area, ...tail] = rest.split("/")
  if (area === "enterprise") {
    const item = matchItem(ENTERPRISE_NAV, tail.join("/"))
    return [{ label: "Enterprise" }, ...(item ? [{ label: item.title, href: enterpriseHref(slug, item) }] : [])]
  }
  if (area === "p" && tail[0]) {
    const propertyId = tail[0]
    const home = PROPERTY_NAV.find((i) => i.path === "")
    const item = matchItem(PROPERTY_NAV, tail.slice(1).join("/"))
    // The Channel Manager has its own sidebar entry, so its trail starts there, not at Controls.
    const crumbs: Crumb[] = item?.ownEntry ? [] : [{ label: home?.title ?? "Controls", href: `${root}/p/${propertyId}` }]
    if (item) {
      const parent = parentOf(PROPERTY_NAV, item)
      if (parent) crumbs.push({ label: parent.title, href: propertyHref(slug, propertyId, parent) })
      crumbs.push({ label: item.title, href: propertyHref(slug, propertyId, item) })
    }
    return crumbs
  }
  return []
}

export function HubBreadcrumbs({ slug }: { slug: string }) {
  const pathname = usePathname()
  const crumbs = crumbsFor(pathname, slug)
  if (crumbs.length === 0) return null

  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <Fragment key={`${i}-${c.label}`}>
              {i > 0 && (
                <li aria-hidden className="text-muted-foreground/60">
                  ›
                </li>
              )}
              <li>
                {last || !c.href ? (
                  <span className={last ? "font-medium text-foreground" : undefined} aria-current={last ? "page" : undefined}>
                    {c.label}
                  </span>
                ) : (
                  <Link href={c.href} className="hover:text-foreground hover:underline">
                    {c.label}
                  </Link>
                )}
              </li>
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}
