import { LayoutDashboard, Building2, ClipboardCheck, KeyRound, ShieldCheck, Activity } from "@/components/icons"
import { requireSession } from "@/lib/scope"
import { prisma } from "@/lib/db"
import { LogoutButton } from "@/components/logout-button"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

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
  { title: "DB Health", url: "/osta/db-health", icon: Activity },
]

export async function OstaSidebar() {
  const ctx = await requireSession().catch(() => null)
  const user = ctx
    ? await prisma.user.findUnique({ where: { id: ctx.userId }, select: { firstName: true, lastName: true, role: { select: { name: true } } } })
    : null
  const name = user ? `${user.firstName} ${user.lastName}` : "Osta"
  const roleName = user?.role.name ?? ""

  return (
    <Sidebar collapsible="icon">
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
            <SidebarMenuButton>
              <div className="flex flex-col items-start px-2 py-1">
                <span className="text-sm font-semibold truncate w-full">{name}</span>
                <span className="text-xs text-muted-foreground truncate w-full">{roleName}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem className="mt-2">
            <LogoutButton />
          </SidebarMenuItem>
        </SidebarMenu>
      </div>
    </Sidebar>
  )
}
