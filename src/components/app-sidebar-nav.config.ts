import {
  Calculator,
  CalendarDays,
  ClipboardList,
  Compass,
  Contact,
  ConciergeBell,
  FileBarChart,
  FileStack,
  History,
  Landmark,
  LayoutGrid,
  Settings,
  Store,
  TrendingUp,
  UsersRound,
  Wallet,
  Wrench,
} from "@/components/icons"
import type { Module } from "@/lib/scope"

// Deliberately NOT a "use client" module, even though only the client nav renders it:
// app-sidebar.tsx is a Server Component and needs to read NAV_MODULES as a real array.
// Anything a server component imports from a "use client" file comes back as an opaque
// client-reference proxy, not the value — a plain array exported from there would blow
// up with "NAV_MODULES.filter is not a function". Keeping the config in a neutral
// module lets both sides import the same source of truth.

export type NavItem = {
  title: string
  url: string
  icon: React.ComponentType<{ className?: string }>
  module: Module
}
export type NavGroup = { label: string; items: NavItem[] }

// Nav is grouped by how the property actually runs a day, not alphabetically:
// Operations (selling and occupying rooms) -> Services (what happens in and around
// the room) -> Finance (money in, money closed) -> Reports -> Setup. Within each
// group the order follows the natural workflow, e.g. Finance runs Revenue (price it)
// -> Cashiering (collect it) -> Debtors (chase it) -> Night Audit (close the day).
// `module` drives visibility via the session's RolePermission.canView — the filtering
// itself happens server-side in app-sidebar.tsx, which passes the allowed set down.
// Icons are deliberately unique per item: two entries sharing an icon are
// indistinguishable once the sidebar is collapsed to icon-only.
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { title: "Front Desk", url: "/dashboard/front-office", icon: ConciergeBell, module: "FRONT_DESK" },
      { title: "Reservations", url: "/dashboard/reservations", icon: CalendarDays, module: "RESERVATIONS" },
      { title: "Tape Chart", url: "/dashboard/reservations/tape-chart", icon: LayoutGrid, module: "TAPE_CHART" },
      { title: "Group Blocks", url: "/dashboard/groups", icon: UsersRound, module: "GROUP_BLOCKS" },
      { title: "Client Relations", url: "/dashboard/profiles", icon: Contact, module: "PROFILES" },
    ],
  },
  {
    label: "Services",
    items: [
      { title: "Housekeeping", url: "/dashboard/housekeeping", icon: ClipboardList, module: "HOUSEKEEPING" },
      { title: "Maintenance", url: "/dashboard/maintenance", icon: Wrench, module: "MAINTENANCE" },
      { title: "Point of Sale", url: "/dashboard/pos", icon: Store, module: "POS" },
      { title: "Excursions", url: "/dashboard/excursions", icon: Compass, module: "EXCURSIONS" },
    ],
  },
  {
    label: "Finance",
    items: [
      { title: "Revenue", url: "/dashboard/revenue", icon: TrendingUp, module: "REVENUE" },
      { title: "Cashiering", url: "/dashboard/cashiering", icon: Wallet, module: "CASHIERING" },
      { title: "Debtors", url: "/dashboard/debtors", icon: Landmark, module: "DEBTORS" },
      { title: "Night Audit", url: "/dashboard/financials/night-audit", icon: Calculator, module: "NIGHT_AUDIT" },
    ],
  },
  {
    label: "Reports",
    items: [
      { title: "Daily Reports", url: "/dashboard/reports", icon: FileBarChart, module: "REPORTS" },
      { title: "Activity Log", url: "/dashboard/activity-log", icon: History, module: "ACTIVITY_LOG" },
    ],
  },
  {
    label: "Setup",
    items: [
      { title: "Stationaries", url: "/dashboard/stationaries", icon: FileStack, module: "CONTROLS" },
      { title: "Controls", url: "/dashboard/controls", icon: Settings, module: "CONTROLS" },
    ],
  },
]

// Every module referenced by the nav, de-duplicated (Stationaries and Controls share
// CONTROLS). app-sidebar.tsx filters this server-side and passes back the allowed set.
export const NAV_MODULES: Module[] = [...new Set(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.module)))]
