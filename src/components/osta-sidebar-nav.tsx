"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Building2, ReceiptText, ShieldCheck, Activity, Settings, ArrowLeftRight } from "@/components/icons"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { activeHref } from "@/components/app-sidebar-nav"
import type { OstaNavCounts } from "@/lib/osta/attention"
import { cn } from "@/lib/utils"

// A small, static nav for the Osta platform-admin console — deliberately NOT
// module/permission-filtered like AppSidebar (src/components/app-sidebar.tsx), since
// these pages aren't tenant RBAC modules, they're the console itself. Every Osta user
// who reaches /osta has already passed the isInternal + CONTROLS-permission gate in
// src/app/osta/layout.tsx. Client component only for the pathname (active item).
//
// Grouped by the job (customers, billing, operations, platform) rather than one flat
// list. A count shows what is waiting on that page; `hot` counts (something is broken)
// get the Crimson fill.
type Item = {
  title: string
  url: string
  icon: React.ComponentType<{ className?: string }>
  count?: (c: OstaNavCounts) => { value: number; label?: string; hot?: boolean }
}

// Also the Pages list of the console's Ctrl+K palette (OstaCommandPalette).
export const OSTA_NAV_GROUPS: { label: string | null; items: Item[] }[] = [
  {
    label: null,
    items: [{ title: "Today", url: "/osta", icon: LayoutDashboard }],
  },
  {
    label: "Customers",
    // Property approvals live on Today's inbox and each enterprise's Properties tab, so
    // the count rides on Enterprises (owner, 2026-11-08: no separate approvals page).
    items: [{ title: "Enterprises", url: "/osta/enterprises", icon: Building2, count: (c) => ({ value: c.pendingProperties, label: `${c.pendingProperties} pending` }) }],
  },
  {
    label: "Finance",
    // Read-only overview; invoices are issued and paid on the enterprise's Billing tab.
    items: [{ title: "Billing", url: "/osta/billing", icon: ReceiptText, count: (c) => ({ value: c.unpaidInvoices, label: `${c.unpaidInvoices} unpaid` }) }],
  },
  {
    label: "Operations",
    items: [
      { title: "Support Access", url: "/osta/support-access", icon: ShieldCheck, count: (c) => ({ value: c.liveSupportGrants, label: `${c.liveSupportGrants} live` }) },
      { title: "Channel Manager", url: "/osta/channel-manager", icon: ArrowLeftRight, count: (c) => ({ value: c.failingChannels, label: `${c.failingChannels} failing`, hot: true }) },
    ],
  },
  {
    label: "Platform",
    items: [
      { title: "Monitoring", url: "/osta/monitoring", icon: Activity },
      { title: "Controls", url: "/osta/controls", icon: Settings },
    ],
  },
]

export function OstaSidebarNav({ counts }: { counts: OstaNavCounts | null }) {
  const pathname = usePathname() ?? ""
  // Longest prefix wins, so "/osta" (Today) doesn't light up on every console page.
  // A property page belongs to its enterprise.
  const current = pathname.startsWith("/osta/properties")
    ? "/osta/enterprises"
    : activeHref(pathname, OSTA_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.url)))

  return (
    <>
      {OSTA_NAV_GROUPS.map((group) => (
        <SidebarGroup key={group.label ?? "home"} className={group.label ? "py-1" : undefined}>
          {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
                const badge = counts && item.count ? item.count(counts) : null
                const label = badge && badge.value > 0 ? (badge.label ?? String(badge.value)) : null
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      tooltip={label ? `${item.title} · ${label}` : item.title}
                      isActive={item.url === current}
                      render={<Link href={item.url} />}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                    {label && (
                      <SidebarMenuBadge
                        className={cn(
                          "rounded-none px-1.5 font-mono text-[11px]",
                          badge!.hot
                            ? "bg-primary text-primary-foreground peer-hover/menu-button:text-primary-foreground peer-data-active/menu-button:text-primary-foreground"
                            : "bg-sidebar-primary text-sidebar-primary-foreground peer-hover/menu-button:text-sidebar-primary-foreground peer-data-active/menu-button:text-sidebar-primary-foreground"
                        )}
                      >
                        {label}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  )
}
