import { LayoutDashboard, ArrowLeftRight, Building2, FileText, ShieldAlert, Users, Shield } from "@/components/icons"
import { requireSession, hasHubAccess, hasAnyPropertyModule, resolveCurrentPropertyId } from "@/lib/scope"
import { prisma } from "@/lib/db"
import { LogoutButton } from "@/components/logout-button"
import { HubPropertySwitcher } from "@/components/hub/hub-property-switcher"
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

// The Hub's nav — a small static list, same approach as OstaSidebar
// (src/components/osta-sidebar.tsx) and deliberately NOT the permission-filtered
// AppSidebar. Everyone who reaches /e/{slug}/hub has already passed requireHubAccess()
// in the layout, and for now the Hub is a single module (INTEGRATIONS); when a second
// Hub module lands, filter this list against HUB_MODULES the way AppSidebar does.
//
// Note this cannot reuse SidebarUserMenu (src/components/ui/sidebar-user-menu.tsx) —
// that component calls useProperty(), which by design does not exist in the Hub. The
// property list below instead comes down as server-rendered props (see
// HubPropertySwitcher); the identity footer itself matches OstaSidebar's.
const items = [
  { title: "Overview", url: "hub", icon: LayoutDashboard },
  { title: "Channel Manager", url: "hub/channel-manager", icon: ArrowLeftRight },
  { title: "Mapping", url: "hub/channel-manager/mapping", icon: Building2 },
  { title: "Inbound Bookings", url: "hub/channel-manager/bookings", icon: ShieldAlert },
  { title: "Exchange Log", url: "hub/channel-manager/logs", icon: FileText },
  // Staff administration moved here from Controls (2026-08-04): identity is
  // enterprise-wide, and the Hub is the only shell a property-scoped user can't reach.
  { title: "People", url: "hub/people", icon: Users },
  { title: "Sessions", url: "hub/sessions", icon: Shield },
]

export async function HubSidebar({ slug }: { slug: string }) {
  const ctx = await requireSession().catch(() => null)
  if (!ctx || !hasHubAccess(ctx)) return null

  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { firstName: true, lastName: true, roles: { select: { role: { select: { name: true } } } } },
  })
  const name = user ? `${user.firstName} ${user.lastName}` : "Hub"
  // A user may hold several roles; the chrome shows them joined rather than
  // picking one arbitrarily.
  const roleName = user?.roles.map((ur) => ur.role.name).join(", ") ?? ""

  // A Hub-only administrator has nowhere to go back to — only offer the return link
  // when the user actually holds a property-operational module.
  const canReturnToProperty = hasAnyPropertyModule(ctx)
  const [properties, currentPropertyId] = canReturnToProperty
    ? await Promise.all([
        prisma.property.findMany({
          where: { enterpriseId: ctx.enterpriseId, status: "ACTIVE" },
          select: { id: true, name: true, bannerColor: true },
          orderBy: { createdAt: "asc" },
        }),
        resolveCurrentPropertyId(ctx),
      ])
    : [[], null]

  return (
    <Sidebar collapsible="icon">
      {/* Same product mark as the tenant AppSidebar's rail, so the Hub doesn't read as
          a different, unbranded app. "Hub" replaces "Stay" as the module tag. */}
      <SidebarHeader className="h-16 justify-center px-3 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:items-center">
        <Link href={`/e/${slug}/hub`} className="flex items-center gap-2.5 outline-hidden focus-visible:ring-2 ring-sidebar-ring">
          <UppsolutIcon className="h-8 w-8 shrink-0" title="Uppsolut Hub" tile={false} />
          <span className="flex flex-col leading-none text-sidebar-foreground group-data-[collapsible=icon]:hidden">
            <UppsolutWordmark className="h-[12px] w-auto" title={null} />
            <span className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.22em] opacity-65">Hub</span>
          </span>
        </Link>
      </SidebarHeader>
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

        {canReturnToProperty && properties.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Switch to a property</SidebarGroupLabel>
            <SidebarGroupContent>
              <HubPropertySwitcher slug={slug} properties={properties} currentPropertyId={currentPropertyId} />
            </SidebarGroupContent>
          </SidebarGroup>
        )}
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
