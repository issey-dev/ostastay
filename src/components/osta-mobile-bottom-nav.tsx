"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSidebar } from "@/components/ui/sidebar"
import { Menu } from "@/components/icons"
import { activeHref } from "@/components/app-sidebar-nav"
import { OSTA_NAV_GROUPS, ostaActiveUrl } from "@/components/osta-sidebar-nav"
import type { OstaNavCounts } from "@/lib/osta/attention"
import { cn } from "@/lib/utils"

// Phones only (md:hidden): the Osta console's four most-used pages, plus "More", which
// opens the full sidebar as a sheet. Same shape and the same `data-mobile-nav` marker as
// the tenant MobileBottomNav (src/components/mobile-bottom-nav.tsx), so toasts and other
// bottom-pinned bars lift above it (globals.css `--bottom-nav-offset`).
//
// Items come from OSTA_NAV_GROUPS, so a renamed or re-iconed page changes here too. The
// counts the sidebar shows ride on the icons as a small badge; `hot` ones (something is
// broken) use the primary fill.
const SLOTS = ["/osta", "/osta/enterprises", "/osta/billing", "/osta/channel-manager"]
// Five slots share ~72px each on a 360px phone: short labels so none is cut off.
const SHORT_TITLE: Record<string, string> = {
  "Channel Manager": "Channels",
}

export function OstaMobileBottomNav({ counts }: { counts: OstaNavCounts | null }) {
  const pathname = usePathname() ?? ""
  const { setOpenMobile, openMobile } = useSidebar()
  const all = OSTA_NAV_GROUPS.flatMap((g) => g.items)
  const slots = SLOTS.map((url) => all.find((i) => i.url === url)).filter((i) => i !== undefined)
  const current = ostaActiveUrl(pathname)
  const onSlot = slots.some((i) => i.url === current)
  // Anything waiting on a page that is NOT in the bar shows as a dot on "More".
  const hiddenWaiting = counts
    ? all.some((i) => !SLOTS.includes(i.url) && i.count && i.count(counts).value > 0)
    : false

  return (
    <nav
      aria-label="Main"
      data-mobile-nav=""
      className="fixed inset-x-0 bottom-0 z-[var(--z-banner)] border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden print:hidden"
    >
      <ul className="grid h-16" style={{ gridTemplateColumns: `repeat(${slots.length + 1}, minmax(0, 1fr))` }}>
        {slots.map((item) => {
          const active = item.url === current
          const badge = counts && item.count ? item.count(counts) : null
          const n = badge?.value ?? 0
          return (
            <li key={item.url}>
              <Link
                href={item.url}
                aria-current={active ? "page" : undefined}
                aria-label={n > 0 && badge?.label ? `${item.title}, ${badge.label}` : undefined}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium leading-none transition-colors",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                <span className="relative">
                  <item.icon className="h-5 w-5 shrink-0" />
                  {n > 0 && (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute -top-1.5 left-3 min-w-4 rounded-full px-1 text-center font-mono text-[10px] font-semibold leading-4",
                        badge!.hot ? "bg-primary text-primary-foreground" : "bg-foreground text-background"
                      )}
                    >
                      {n > 9 ? "9+" : n}
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate">{SHORT_TITLE[item.title] ?? item.title}</span>
              </Link>
            </li>
          )
        })}
        <li>
          <button
            type="button"
            onClick={() => setOpenMobile(!openMobile)}
            aria-expanded={openMobile}
            aria-label={hiddenWaiting ? "More, items waiting" : "More"}
            className={cn(
              "flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium leading-none transition-colors",
              !onSlot || openMobile ? "text-primary" : "text-muted-foreground"
            )}
          >
            <span className="relative">
              <Menu className="h-5 w-5 shrink-0" />
              {hiddenWaiting && <span aria-hidden className="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-primary" />}
            </span>
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  )
}
