import { requireSession, hasHubAccess, hasEnterpriseHubAccess, hasAnyPropertyModule, hasPermission, resolveCurrentPropertyId } from "@/lib/scope"
import { prisma } from "@/lib/db"
import { LogoutButton } from "@/components/logout-button"
import { HubPropertySwitcher } from "@/components/hub/hub-property-switcher"
import { HubSidebarNav } from "@/components/hub/hub-sidebar-nav"
import { ENTERPRISE_NAV, PROPERTY_NAV, visibleKeys } from "@/components/hub/hub-nav"
import { listHubProperties, resolveHubPropertyId } from "@/lib/hub-properties"
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

// The Hub's nav — deliberately NOT the permission-filtered AppSidebar. Two areas, kept
// visibly apart (2026-09-23, .agents/docs/HUB_SETUP_PLAN.md):
//   "Enterprise · all properties" — shared settings; never shown to a single-property user
//   "<property name>"             — one property's setup, headed by that property
// The item lists live in src/components/hub/hub-nav.ts; this server half decides which
// items the user may see, the client half (HubSidebarNav) knows which page is open.
//
// Note this cannot reuse SidebarUserMenu (src/components/ui/sidebar-user-menu.tsx) —
// that component calls useProperty(), which by design does not exist in the Hub. The
// property lists below instead come down as server-rendered props; the identity footer
// matches OstaSidebar's.

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

  const canView = (m: Parameters<typeof hasPermission>[1]) => hasPermission(ctx, m, "view")
  const showEnterprise = hasEnterpriseHubAccess(ctx)
  const enterpriseKeys = showEnterprise ? visibleKeys(ENTERPRISE_NAV, canView) : []
  const propertyKeys = visibleKeys(PROPERTY_NAV, canView)
  const hubProperties = await listHubProperties(ctx)
  const defaultPropertyId = await resolveHubPropertyId(ctx, hubProperties)

  // "Open a property's dashboard" — only when the user actually works in properties. A
  // single-property user only ever has their own.
  const canReturnToProperty = hasAnyPropertyModule(ctx)
  const [dashboardProperties, currentPropertyId] = canReturnToProperty
    ? await Promise.all([
        prisma.property.findMany({
          where: {
            enterpriseId: ctx.enterpriseId,
            status: "ACTIVE",
            ...(ctx.scope === "PROPERTY" ? { id: ctx.propertyId ?? "" } : {}),
          },
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
        <HubSidebarNav
          slug={slug}
          showOverview={showEnterprise}
          enterpriseKeys={enterpriseKeys}
          propertyKeys={propertyKeys}
          properties={hubProperties}
          defaultPropertyId={defaultPropertyId}
        />

        {canReturnToProperty && dashboardProperties.length > 0 && (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Open property dashboard</SidebarGroupLabel>
            <SidebarGroupContent>
              <HubPropertySwitcher slug={slug} properties={dashboardProperties} currentPropertyId={currentPropertyId} />
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
