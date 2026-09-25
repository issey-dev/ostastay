"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Building2, ClipboardCheck, KeyRound, ShieldCheck, Activity, Settings, ArrowLeftRight } from "@/components/icons"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { activeHref } from "@/components/app-sidebar-nav"

// A small, static nav for the Osta platform-admin console — deliberately NOT
// module/permission-filtered like AppSidebar (src/components/app-sidebar.tsx), since
// these pages aren't tenant RBAC modules, they're the console itself. Every Osta user
// who reaches /osta has already passed the isInternal + CONTROLS-permission gate in
// src/app/osta/layout.tsx. Client component only for the pathname (active item).
const items = [
  { title: "Overview", url: "/osta", icon: LayoutDashboard },
  { title: "Enterprises", url: "/osta/enterprises", icon: Building2 },
  { title: "Property Approvals", url: "/osta/properties", icon: ClipboardCheck },
  { title: "Licensing", url: "/osta/licensing", icon: KeyRound },
  { title: "Support Access", url: "/osta/support-access", icon: ShieldCheck },
  { title: "Channel Manager", url: "/osta/channel-manager", icon: ArrowLeftRight },
  { title: "DB Health", url: "/osta/db-health", icon: Activity },
  { title: "Controls", url: "/osta/controls", icon: Settings },
]

export function OstaSidebarNav() {
  const pathname = usePathname() ?? ""
  // Longest prefix wins, so "/osta" (Overview) doesn't light up on every console page.
  const current = activeHref(pathname, items.map((i) => i.url))

  return (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.title}>
          <SidebarMenuButton tooltip={item.title} isActive={item.url === current} render={<Link href={item.url} />}>
            <item.icon className="h-4 w-4" />
            <span>{item.title}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}
