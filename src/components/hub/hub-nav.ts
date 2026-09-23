import type { ComponentType } from "react"
import type { Module } from "@/lib/modules"
import {
  ArrowLeftRight,
  Boxes,
  Building2,
  CalendarDays,
  Compass,
  FileText,
  Hash,
  Key,
  LayoutDashboard,
  ListChecks,
  Mail,
  Receipt,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Store,
  TrendingUp,
  Users,
  Wallet,
} from "@/components/icons"

// The Hub's navigation, in one place — the sidebar, the property landing page and the
// Overview all read these lists. See .agents/docs/HUB_SETUP_PLAN.md.
//
// Two areas, never mixed:
//   ENTERPRISE_NAV → /e/{slug}/hub/enterprise/{path}      shared by every property
//   PROPERTY_NAV   → /e/{slug}/hub/p/{propertyId}/{path}  one property at a time
//
// An item is shown when the user holds `view` on ANY of its modules (and, for Spa and
// Excursions, when the enterprise holds that add-on). Adding a section is adding a row
// here plus its page; nothing else in the shell needs to change.

export type HubAddon = "SPA" | "EXCURSIONS"

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
  // Only when the enterprise holds this add-on.
  addon?: HubAddon
  // Enterprise items that are still shared by every property but are moving to each
  // property's own setup in a later phase. Shown in their own, clearly-labelled group
  // so nobody mistakes them for settings that are meant to be shared.
  interim?: boolean
}

export const ENTERPRISE_NAV: HubNavItem[] = [
  { key: "properties", title: "Properties", path: "properties", icon: Building2, modules: ["CONTROLS"] },
  { key: "people", title: "People", path: "people", icon: Users, modules: ["USERS"] },
  { key: "sessions", title: "Sessions", path: "sessions", icon: Shield, modules: ["USERS"] },
  { key: "email", title: "Email & SFTP", path: "email", icon: Mail, modules: ["CONTROLS"] },
  { key: "channel-manager", title: "Channel Manager", path: "channel-manager", icon: ArrowLeftRight, modules: ["INTEGRATIONS"] },
  { key: "channel-mapping", title: "Mapping", path: "channel-manager/mapping", icon: Building2, modules: ["INTEGRATIONS"], child: true },
  { key: "channel-bookings", title: "Inbound Bookings", path: "channel-manager/bookings", icon: ShieldAlert, modules: ["INTEGRATIONS"], child: true },
  { key: "channel-logs", title: "Exchange Log", path: "channel-manager/logs", icon: FileText, modules: ["INTEGRATIONS"], child: true },
  { key: "booking-api", title: "Booking API", path: "booking-api", icon: Key, modules: ["INTEGRATIONS"] },
  { key: "green-tax", title: "Green Tax", path: "green-tax", icon: Receipt, modules: ["GREEN_TAX"] },
  { key: "support-access", title: "Support Access", path: "support-access", icon: ShieldCheck, modules: ["CONTROLS"] },

  // Still shared by every property — each moves into the property's own setup (Phase 2
  // for tax / payments / charge codes, Phase 3 for dropdown lists).
  { key: "shared-finance", title: "Tax & Payments", path: "finance", icon: Wallet, modules: ["CONTROLS"], interim: true },
  { key: "shared-cashiering", title: "Charge Codes", path: "cashiering", icon: Receipt, modules: ["CONTROLS"], interim: true },
  { key: "shared-lists", title: "Dropdown Lists", path: "lists", icon: ListChecks, modules: ["CONTROLS"], interim: true },
]

export const PROPERTY_NAV: HubNavItem[] = [
  { key: "home", title: "Setup", path: "", icon: LayoutDashboard, modules: ["CONTROLS", "INTEGRATIONS", "GREEN_TAX"] },
  {
    key: "general",
    title: "General",
    path: "general",
    icon: Settings2,
    modules: ["CONTROLS"],
    description: "Name, logo, contact details, times, appearance and idle sign-out.",
  },
  {
    key: "inventory",
    title: "Rooms & Inventory",
    path: "inventory",
    icon: Boxes,
    modules: ["CONTROLS"],
    description: "Room types, buildings, floors and rooms.",
  },
  {
    key: "reservations",
    title: "Reservations",
    path: "reservations",
    icon: CalendarDays,
    modules: ["CONTROLS"],
    description: "The booking number format.",
  },
  {
    key: "revenue",
    title: "Revenue",
    path: "revenue",
    icon: TrendingUp,
    modules: ["CONTROLS"],
    description: "Meal plans, and whether meal plan or rate plan drives allocations.",
  },
  {
    key: "finance",
    title: "Finance",
    path: "finance",
    icon: Wallet,
    modules: ["CONTROLS"],
    description: "Deposit, cancellation and no-show fee rules.",
  },
  {
    key: "outlets",
    title: "Outlets",
    path: "outlets",
    icon: Store,
    modules: ["CONTROLS"],
    description: "Restaurants, bars and other points of sale, and the amenities guests see.",
  },
  {
    key: "excursions",
    title: "Excursions",
    path: "excursions",
    icon: Compass,
    modules: ["CONTROLS"],
    addon: "EXCURSIONS",
    description: "Activities sold to guests: catalogue, pricing and schedules.",
  },
  {
    key: "spa",
    title: "Spa",
    path: "spa",
    icon: Sparkles,
    modules: ["CONTROLS"],
    addon: "SPA",
    description: "Treatments, therapists, treatment rooms and spa policies.",
  },
  {
    key: "stationery",
    title: "Stationery",
    path: "stationery",
    icon: FileText,
    modules: ["CONTROLS"],
    description: "Wording on invoices, receipts, letters, the registration card and statements.",
  },
  {
    key: "sequences",
    title: "Sequences",
    path: "sequences",
    icon: Hash,
    modules: ["CONTROLS"],
    description: "Current registration, folio, invoice and receipt numbers.",
  },
]

export function enterpriseHref(slug: string, item: Pick<HubNavItem, "path">): string {
  return `/e/${slug}/hub/enterprise${item.path ? `/${item.path}` : ""}`
}

export function propertyHref(slug: string, propertyId: string, item: Pick<HubNavItem, "path">): string {
  return `/e/${slug}/hub/p/${propertyId}${item.path ? `/${item.path}` : ""}`
}

// Which items a user may see, given the modules they hold `view` on and the add-ons the
// enterprise holds. Computed on the server (permissions never reach the client) and
// passed down as a list of keys.
export function visibleKeys(
  items: HubNavItem[],
  canView: (m: Module) => boolean,
  addons: ReadonlySet<HubAddon> = new Set()
): string[] {
  return items
    .filter((i) => i.modules.some(canView) && (!i.addon || addons.has(i.addon)))
    .map((i) => i.key)
}

export function navItem(items: HubNavItem[], key: string): HubNavItem {
  const item = items.find((i) => i.key === key)
  if (!item) throw new Error(`Unknown Hub nav item: ${key}`)
  return item
}
