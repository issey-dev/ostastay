import { LayoutDashboard, Building2, ClipboardCheck, KeyRound, ShieldCheck, Activity, Settings, ArrowLeftRight } from "@/components/icons"
import { requireSession } from "@/lib/scope"
import { prisma } from "@/lib/db"
import { LogoutButton } from "@/components/logout-button"
import { APP_VERSION } from "@/lib/version"
import { initials } from "@/lib/initials"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { UppsolutIcon, UppsolutWordmark } from "@/components/brand/uppsolut-logo"
import Link from "next/link"

// A small, static nav for the Osta platform-admin console — deliberately NOT
// module/permission-filtered like AppSidebar (src/components/app-sidebar.tsx), since
// these pages aren't tenant RBAC modules, they're the console itself. Every Osta user
// who reaches /osta has already passed the isInternal + CONTROLS-permission gate in
// src/app/osta/layout.tsx.
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

export async function OstaSidebar() {
  const ctx = await requireSession().catch(() => null)
  const user = ctx
    ? await prisma.user.findUnique({ where: { id: ctx.userId }, select: { firstName: true, lastName: true, roles: { select: { role: { select: { name: true } } } } } })
    : null
  const name = user ? `${user.firstName} ${user.lastName}` : "Osta"
  // A user may hold several roles; the chrome shows them joined rather than
  // picking one arbitrarily.
  const roleName = user?.roles.map((ur) => ur.role.name).join(", ") ?? ""

  return (
    <Sidebar collapsible="icon">
      {/* Same product mark as the tenant AppSidebar's rail, so the platform console
          doesn't read as a different, unbranded app. "Osta" replaces "Stay" as the
          module tag since this is the platform-admin console, not the PMS product. */}
      <SidebarHeader className="h-16 justify-center px-3 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:items-center">
        <Link href="/osta" className="flex items-center gap-2.5 outline-hidden focus-visible:ring-2 ring-sidebar-ring">
          <UppsolutIcon className="h-8 w-8 shrink-0" title="Uppsolut Osta" tile={false} />
          <span className="flex flex-col leading-none text-sidebar-foreground group-data-[collapsible=icon]:hidden">
            <UppsolutWordmark className="h-[12px] w-auto" title={null} />
            <span className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.22em] opacity-65">Osta</span>
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Osta</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton tooltip={item.title} render={<a href={item.url} />}>
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <div className="mt-auto p-4 border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton className="h-auto py-2" tooltip={name}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
                {initials(name) || "U"}
              </span>
              <div className="flex flex-col items-start min-w-0">
                <span className="text-sm font-semibold truncate w-full leading-tight">{name}</span>
                <span className="text-xs text-sidebar-foreground/70 truncate w-full leading-tight">{roleName}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem className="mt-2">
            <LogoutButton />
          </SidebarMenuItem>
        </SidebarMenu>
        <p className="mt-2 px-2 text-[10px] text-sidebar-foreground/40 group-data-[collapsible=icon]:hidden">
          Uppsolut Stay v{APP_VERSION}
        </p>
      </div>
    </Sidebar>
  )
}
