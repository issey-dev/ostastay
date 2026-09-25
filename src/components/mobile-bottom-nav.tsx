"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useSidebar } from "@/components/ui/sidebar"
import { Menu } from "@/components/icons"
import { cn } from "@/lib/utils"
import { NAV_GROUPS, type NavItem } from "@/components/app-sidebar-nav.config"
import { activeHref } from "@/components/app-sidebar-nav"
import type { Module } from "@/lib/scope"

// Phones only (md:hidden): the four places this person is most likely to go, plus "More",
// which opens the full menu (the sidebar sheet). Desktop keeps the sidebar alone.
//
// Built from the SAME server-filtered module list as the sidebar (AppSidebar passes it
// down), so it can never offer a destination the menu would hide. Order follows the job:
// someone whose post is Housekeeping or Maintenance lands on their own board first.
const DEFAULT_ORDER = [
  "/dashboard/overview",
  "/dashboard/front-office",
  "/dashboard/reservations",
  "/dashboard/housekeeping",
  "/dashboard/cashiering",
  "/dashboard/pos",
  "/dashboard/maintenance",
  "/dashboard/spa",
  "/dashboard/excursions",
]
const ORDER_BY_JOB: Record<string, string[]> = {
  HOUSEKEEPING: ["/dashboard/housekeeping", "/dashboard/maintenance", "/dashboard/front-office", "/dashboard/overview"],
  MAINTENANCE: ["/dashboard/maintenance", "/dashboard/housekeeping", "/dashboard/front-office", "/dashboard/overview"],
  CASHIER: ["/dashboard/cashiering", "/dashboard/pos", "/dashboard/front-office", "/dashboard/overview"],
  FOOD_BEVERAGE: ["/dashboard/pos", "/dashboard/front-office", "/dashboard/overview", "/dashboard/reservations"],
  SPA: ["/dashboard/spa", "/dashboard/front-office", "/dashboard/overview", "/dashboard/reservations"],
}
const SLOTS = 4
// Five slots share ~72px each on a 360px phone: short labels so none is cut off.
const SHORT_TITLE: Record<string, string> = {
  Reservations: "Bookings",
  Housekeeping: "Rooms",
  Maintenance: "Repairs",
  Cashiering: "Cashier",
  "Fast Post": "Post",
  Excursions: "Trips",
}

export function MobileBottomNav({
  allowedModules,
  enterprisePrefix,
  jobFunction,
}: {
  allowedModules: Module[]
  enterprisePrefix: string
  jobFunction?: string | null
}) {
  const pathname = usePathname()
  const { setOpenMobile, openMobile } = useSidebar()
  const allowed = new Set(allowedModules)
  const items = NAV_GROUPS.flatMap((g) => g.items).filter((i) => !i.module || allowed.has(i.module))
  const byUrl = new Map(items.map((i) => [i.url, i]))
  const preferred = [...(jobFunction ? ORDER_BY_JOB[jobFunction] ?? [] : []), ...DEFAULT_ORDER]
  const slots: NavItem[] = []
  for (const url of preferred) {
    const item = byUrl.get(url)
    if (item && !slots.includes(item)) slots.push(item)
    if (slots.length === SLOTS) break
  }
  const current = activeHref(pathname, items.map((i) => `${enterprisePrefix}${i.url}`))
  // "More" is the current tab when the page you are on isn't one of the slots.
  const onSlot = slots.some((i) => `${enterprisePrefix}${i.url}` === current)

  return (
    <nav
      aria-label="Main"
      data-mobile-nav=""
      className="fixed inset-x-0 bottom-0 z-[var(--z-sticky)] border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden print:hidden"
    >
      <ul className="grid h-16" style={{ gridTemplateColumns: `repeat(${slots.length + 1}, minmax(0, 1fr))` }}>
        {slots.map((item) => {
          const href = `${enterprisePrefix}${item.url}`
          const active = href === current
          return (
            <li key={item.url}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium leading-none transition-colors",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
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
            className={cn(
              "flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium leading-none transition-colors",
              !onSlot || openMobile ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Menu className="h-5 w-5 shrink-0" />
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  )
}
