import { Building2, CalendarDays, Calculator, Users, BarChart3, Settings, LogOut, Wallet, MonitorPlay, User as UserIcon, ClipboardList, Store, Wrench } from "lucide-react"
import { requireSession, type Module } from "@/lib/scope"
import { prisma } from "@/lib/db"
import { LogoutButton } from "./logout-button"
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
    title: "Profiles & CRM",
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
    title: "Daily Reports",
    url: "/dashboard/reports",
    icon: CalendarDays,
    module: "REPORTS",
  },
  {
    title: "Settings",
    url: "/dashboard/settings",
    icon: Settings,
    module: "CONTROLS",
  },
]

export async function AppSidebar() {
  const ctx = await requireSession().catch(() => null);
  if (!ctx) return null;

  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { firstName: true, lastName: true, role: { select: { name: true } } },
  });
  const name = user ? `${user.firstName} ${user.lastName}` : "Guest";
  const roleName = user?.role.name ?? "";

  const filteredItems = items.filter((item) => ctx.permissions.get(item.module)?.canView ?? false);

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Guest House PMS</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton render={<a href={item.url} />}>
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <div className="mt-auto p-4 border-t border-slate-200">
        <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton>
                <div className="flex flex-col items-start px-2 py-1">
                  <span className="text-sm font-semibold truncate w-full">{name}</span>
                  <span className="text-xs text-slate-500 truncate w-full">{roleName}</span>
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
