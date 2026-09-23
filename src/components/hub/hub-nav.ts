import type { ComponentType } from "react"
import type { Module } from "@/lib/modules"
import {
  ArrowLeftRight,
  Building2,
  FileText,
  Key,
  LayoutDashboard,
  Receipt,
  Shield,
  ShieldAlert,
  Users,
} from "@/components/icons"

// The Hub's navigation, in one place — the sidebar, the property landing page and the
// Overview all read these lists. See .agents/docs/HUB_SETUP_PLAN.md.
//
// Two areas, never mixed:
//   ENTERPRISE_NAV → /e/{slug}/hub/enterprise/{path}   shared by every property
//   PROPERTY_NAV   → /e/{slug}/hub/p/{propertyId}/{path}   one property at a time
//
// An item is shown when the user holds `view` on ANY of its modules. Adding a section is
// adding a row here plus its page; nothing else in the shell needs to change.

export type HubNavItem = {
  key: string
  title: string
  // Relative to the area's root. "" is the area's landing page.
  path: string
  icon: ComponentType<{ className?: string }>
  modules: readonly Module[]
  // One-line description, shown on the property landing page's cards.
  description?: string
  // Indented under the previous top-level item (the channel manager's sub-pages).
  child?: boolean
}

export const ENTERPRISE_NAV: HubNavItem[] = [
  { key: "people", title: "People", path: "people", icon: Users, modules: ["USERS"] },
  { key: "sessions", title: "Sessions", path: "sessions", icon: Shield, modules: ["USERS"] },
  { key: "channel-manager", title: "Channel Manager", path: "channel-manager", icon: ArrowLeftRight, modules: ["INTEGRATIONS"] },
  { key: "channel-mapping", title: "Mapping", path: "channel-manager/mapping", icon: Building2, modules: ["INTEGRATIONS"], child: true },
  { key: "channel-bookings", title: "Inbound Bookings", path: "channel-manager/bookings", icon: ShieldAlert, modules: ["INTEGRATIONS"], child: true },
  { key: "channel-logs", title: "Exchange Log", path: "channel-manager/logs", icon: FileText, modules: ["INTEGRATIONS"], child: true },
  { key: "booking-api", title: "Booking API", path: "booking-api", icon: Key, modules: ["INTEGRATIONS"] },
  { key: "green-tax", title: "Green Tax", path: "green-tax", icon: Receipt, modules: ["GREEN_TAX"] },
]

export const PROPERTY_NAV: HubNavItem[] = [
  {
    key: "home",
    title: "Setup",
    path: "",
    icon: LayoutDashboard,
    modules: ["CONTROLS", "INTEGRATIONS", "GREEN_TAX"],
  },
]

export function enterpriseHref(slug: string, item: Pick<HubNavItem, "path">): string {
  return `/e/${slug}/hub/enterprise${item.path ? `/${item.path}` : ""}`
}

export function propertyHref(slug: string, propertyId: string, item: Pick<HubNavItem, "path">): string {
  return `/e/${slug}/hub/p/${propertyId}${item.path ? `/${item.path}` : ""}`
}

// Which items a user may see, given the modules they hold `view` on. Computed on the
// server (permissions never reach the client) and passed down as a list of keys.
export function visibleKeys(items: HubNavItem[], canView: (m: Module) => boolean): string[] {
  return items.filter((i) => i.modules.some(canView)).map((i) => i.key)
}
