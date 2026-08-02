import { requireSession, hasHubAccess, type Module } from "@/lib/scope"
import { prisma } from "@/lib/db"
import { SidebarUserMenu } from "@/components/ui/sidebar-user-menu"
import { AppSidebarNav } from "@/components/app-sidebar-nav"
// NAV_MODULES comes from the neutral config module, not from the "use client" nav —
// a server component reading a value out of a client module gets a reference proxy.
import { NAV_MODULES } from "@/components/app-sidebar-nav.config"
import { Sidebar, SidebarContent, SidebarMenu } from "@/components/ui/sidebar"

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

  // Modules sold as an add-on (see EnterpriseAddonAccess) need an extra check beyond
  // the usual role licensing below: the enterprise must actually have purchased it.
  // Enterprise-scoped since 2026-08-02 (owner decision) — enabled means every property
  // in the enterprise sees it. Grows one entry at a time as new add-ons ship — see
  // src/components/osta/enterprise-addon-access-manager.tsx's own ADD_ON_MODULES list,
  // which must stay in sync with this one.
  const ADD_ON_MODULES: ReadonlySet<Module> = new Set(["EXCURSIONS", "SPA"]);
  const enabledAddOns = new Set(
    (
      await prisma.enterpriseAddonAccess.findMany({
        where: { enterpriseId: ctx.enterpriseId, enabled: true },
        select: { module: true },
      })
    ).map((r) => r.module)
  );

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
  // it's a separate enterprise-level shell (see .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md).
  // It no longer gets its own sidebar group; it's offered from the Account menu instead
  // (SidebarUserMenu), alongside property switching — one place for "where am I going".
  const showHub = hasHubAccess(ctx) && enterprisePrefix !== "";

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <AppSidebarNav allowedModules={allowedModules} enterprisePrefix={enterprisePrefix} />
      </SidebarContent>
      <div className="mt-auto p-4 border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarUserMenu
            name={name}
            roleName={roleName}
            email={user?.email}
            hubHref={showHub ? `${enterprisePrefix}/hub` : undefined}
          />
        </SidebarMenu>
      </div>
    </Sidebar>
  )
}
