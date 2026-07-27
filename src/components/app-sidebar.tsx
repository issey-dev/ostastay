import { requireSession, resolveCurrentPropertyId, hasHubAccess, type Module } from "@/lib/scope"
import { prisma } from "@/lib/db"
import { ArrowLeftRight } from "@/components/icons"
import { SidebarUserMenu } from "@/components/ui/sidebar-user-menu"
import { AppSidebarNav } from "@/components/app-sidebar-nav"
// NAV_MODULES comes from the neutral config module, not from the "use client" nav —
// a server component reading a value out of a client module gets a reference proxy.
import { NAV_MODULES } from "@/components/app-sidebar-nav.config"
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

export async function AppSidebar() {
  const ctx = await requireSession().catch(() => null);
  if (!ctx) return null;

  const [user, enterprise] = await Promise.all([
    prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { firstName: true, lastName: true, email: true, role: { select: { name: true } } },
    }),
    // ctx.enterpriseId is the EFFECTIVE enterprise (the support-acting-as target when
    // relevant) — links must point there, not the user's own home enterprise.
    prisma.enterprise.findUnique({ where: { id: ctx.enterpriseId }, select: { slug: true } }),
  ]);
  const name = user ? `${user.firstName} ${user.lastName}` : "Guest";
  const roleName = user?.role.name ?? "";
  const enterprisePrefix = enterprise ? `/e/${enterprise.slug}` : "";

  // Modules sold as a per-property add-on (see PropertyModuleAccess) need an extra
  // check beyond the usual role/enterprise-tier licensing below: the CURRENT property
  // must actually have it enabled, not just the enterprise. Grows one entry at a time
  // as new add-ons ship — see src/components/osta/property-module-access-manager.tsx's
  // own ADD_ON_MODULES list, which must stay in sync with this one.
  const ADD_ON_MODULES: ReadonlySet<Module> = new Set(["EXCURSIONS", "SPA"]);
  const currentPropertyId = await resolveCurrentPropertyId(ctx);
  const enabledAddOns = currentPropertyId
    ? new Set(
        (
          await prisma.propertyModuleAccess.findMany({
            where: { propertyId: currentPropertyId, enabled: true },
            select: { module: true },
          })
        ).map((r) => r.module)
      )
    : new Set<string>();

  // Menu ordering/grouping and the active-route highlight live in AppSidebarNav (a
  // client component — it needs usePathname). This stays the sole authority on
  // *visibility*: only the modules that survive the permission/licensing/add-on
  // checks below are ever sent to the client.
  const allowedModules = NAV_MODULES.filter((module) => {
    const hasPermission = (ctx.permissions.get(module)?.canView ?? false) && ctx.licensedModules.has(module);
    if (!hasPermission) return false;
    if (ADD_ON_MODULES.has(module) && !enabledAddOns.has(module)) return false;
    return true;
  });

  // The Hub is not a property module and deliberately never appears in NAV_MODULES —
  // it's a separate enterprise-level shell (see .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md),
  // so it gets its own group here rather than joining the operational nav groups.
  const showHub = hasHubAccess(ctx) && enterprisePrefix !== "";

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <AppSidebarNav allowedModules={allowedModules} enterprisePrefix={enterprisePrefix} />
        {showHub && (
          <SidebarGroup>
            <SidebarGroupLabel>Enterprise</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Hub" render={<a href={`${enterprisePrefix}/hub`} />}>
                    <ArrowLeftRight className="h-4 w-4" />
                    <span>Hub</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <div className="mt-auto p-4 border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarUserMenu name={name} roleName={roleName} email={user?.email} />
        </SidebarMenu>
      </div>
    </Sidebar>
  )
}
