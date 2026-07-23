import { Building2, CalendarDays, Calculator, Users, BarChart3, Settings, LogOut, Wallet, MonitorPlay, User as UserIcon, ClipboardList, Store, Wrench, Landmark, FileStack, History, CalendarClock, Sparkles } from "lucide-react"
import { requireSession, resolveCurrentPropertyId, type Module } from "@/lib/scope"
import { prisma } from "@/lib/db"
import { SidebarUserMenu } from "@/components/ui/sidebar-user-menu"
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

// Menu items logically grouped by module. `module` drives visibility via the session's
// RolePermission.canView for that module — see the filter below.
const items: { title: string; url: string; icon: typeof MonitorPlay; module: Module }[] = [
  {
    title: "Front Desk",
    url: "/dashboard/front-office",
    icon: MonitorPlay,
    module: "FRONT_DESK",
  },
  {
    title: "Housekeeping",
    url: "/dashboard/housekeeping",
    icon: ClipboardList,
    module: "HOUSEKEEPING",
  },
  {
    title: "Maintenance",
    url: "/dashboard/maintenance",
    icon: Wrench,
    module: "MAINTENANCE",
  },
  {
    title: "Night Audit",
    url: "/dashboard/financials/night-audit",
    icon: Calculator,
    module: "NIGHT_AUDIT",
  },
  {
    title: "Client Relations",
    url: "/dashboard/profiles",
    icon: Users,
    module: "PROFILES",
  },
  {
    title: "Revenue",
    url: "/dashboard/revenue",
    icon: BarChart3,
    module: "REVENUE",
  },
  {
    title: "Reservations",
    url: "/dashboard/reservations",
    icon: CalendarDays,
    module: "RESERVATIONS",
  },
  {
    title: "Group Blocks",
    url: "/dashboard/groups",
    icon: Users,
    module: "GROUP_BLOCKS",
  },
  {
    title: "Tape Chart",
    url: "/dashboard/reservations/tape-chart",
    icon: CalendarDays,
    module: "TAPE_CHART",
  },
  {
    title: "Cashiering",
    url: "/dashboard/cashiering",
    icon: Wallet,
    module: "CASHIERING",
  },
  {
    title: "Point of Sale",
    url: "/dashboard/pos",
    icon: Store,
    module: "POS",
  },
  {
    title: "Debtors",
    url: "/dashboard/debtors",
    icon: Landmark,
    module: "DEBTORS",
  },
  {
    title: "Excursions",
    url: "/dashboard/excursions",
    icon: CalendarClock,
    module: "EXCURSIONS",
  },
  {
    title: "Spa",
    url: "/dashboard/spa",
    icon: Sparkles,
    module: "SPA",
  },
  {
    title: "Daily Reports",
    url: "/dashboard/reports",
    icon: CalendarDays,
    module: "REPORTS",
  },
  {
    title: "Stationaries",
    url: "/dashboard/stationaries",
    icon: FileStack,
    module: "CONTROLS",
  },
  {
    title: "Controls",
    url: "/dashboard/controls",
    icon: Settings,
    module: "CONTROLS",
  },
  {
    title: "Activity Log",
    url: "/dashboard/activity-log",
    icon: History,
    module: "ACTIVITY_LOG",
  },
]

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

  const filteredItems = items.filter((item) => {
    const hasPermission = (ctx.permissions.get(item.module)?.canView ?? false) && ctx.licensedModules.has(item.module);
    if (!hasPermission) return false;
    if (ADD_ON_MODULES.has(item.module) && !enabledAddOns.has(item.module)) return false;
    return true;
  });

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>OstaStay</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton render={<a href={`${enterprisePrefix}${item.url}`} />}>
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
          <SidebarUserMenu name={name} roleName={roleName} email={user?.email} />
        </SidebarMenu>
      </div>
    </Sidebar>
  )
}
