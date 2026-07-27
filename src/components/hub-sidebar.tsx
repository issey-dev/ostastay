import { LayoutDashboard, ArrowLeftRight, Building2, FileText } from "@/components/icons"
import { requireSession, hasHubAccess, hasAnyPropertyModule } from "@/lib/scope"
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

// The Hub's nav — a small static list, same approach as OstaSidebar
// (src/components/osta-sidebar.tsx) and deliberately NOT the permission-filtered
// AppSidebar. Everyone who reaches /e/{slug}/hub has already passed requireHubAccess()
// in the layout, and for now the Hub is a single module (INTEGRATIONS); when a second
// Hub module lands, filter this list against HUB_MODULES the way AppSidebar does.
//
// Note this cannot reuse SidebarUserMenu (src/components/ui/sidebar-user-menu.tsx) —
// that component calls useProperty(), which by design does not exist in the Hub. The
// simpler identity footer below matches OstaSidebar's.
const items = [
  { title: "Overview", url: "hub", icon: LayoutDashboard },
  { title: "Channel Manager", url: "hub/channel-manager", icon: ArrowLeftRight },
  { title: "Exchange Log", url: "hub/channel-manager/logs", icon: FileText },
]

export async function HubSidebar({ slug }: { slug: string }) {
  const ctx = await requireSession().catch(() => null)
  if (!ctx || !hasHubAccess(ctx)) return null

  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { firstName: true, lastName: true, role: { select: { name: true } } },
  })
  const name = user ? `${user.firstName} ${user.lastName}` : "Hub"
  const roleName = user?.role.name ?? ""

  // A Hub-only administrator has nowhere to go back to — only offer the return link
  // when the user actually holds a property-operational module.
  const canReturnToProperty = hasAnyPropertyModule(ctx)

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Hub</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton tooltip={item.title} render={<a href={`/e/${slug}/${item.url}`} />}>
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {canReturnToProperty && (
          <SidebarGroup>
            <SidebarGroupLabel>Property</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Back to Property" render={<a href={`/e/${slug}/dashboard`} />}>
                    <Building2 className="h-4 w-4" />
                    <span>Back to Property</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
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
