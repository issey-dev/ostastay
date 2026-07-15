import { Building2, CalendarDays, Calculator, Users, BarChart3, Settings, LogOut, Wallet, MonitorPlay, User as UserIcon, ClipboardList, Store, Wrench } from "lucide-react"
import { getSession } from "@/lib/auth"
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

// Menu items logically grouped by module.
const items = [
  {
    title: "Front Desk",
    url: "/dashboard/front-office",
    icon: MonitorPlay,
  },
  {
    title: "Housekeeping",
    url: "/dashboard/housekeeping",
    icon: ClipboardList,
  },
  {
    title: "Maintenance",
    url: "/dashboard/maintenance",
    icon: Wrench,
  },
  {
    title: "Night Audit",
    url: "/dashboard/financials/night-audit",
    icon: Calculator,
  },
  {
    title: "Profiles & CRM",
    url: "/dashboard/profiles",
    icon: Users,
  },
  {
    title: "Revenue",
    url: "/dashboard/revenue",
    icon: BarChart3,
  },
  {
    title: "Reservations",
    url: "/dashboard/reservations",
    icon: CalendarDays,
  },
  {
    title: "Group Blocks",
    url: "/dashboard/groups",
    icon: Users,
  },
  {
    title: "Tape Chart",
    url: "/dashboard/reservations/tape-chart",
    icon: CalendarDays,
  },
  {
    title: "Cashiering",
    url: "/dashboard/cashiering",
    icon: Wallet,
  },
  {
    title: "Point of Sale",
    url: "/dashboard/pos",
    icon: Store,
  },
  {
    title: "Daily Reports",
    url: "/dashboard/reports",
    icon: CalendarDays,
  },
  {
    title: "Settings",
    url: "/dashboard/settings",
    icon: Settings,
  },
]

export async function AppSidebar() {
  const session = await getSession();
  const role = (session?.role as string) || "FRONT_DESK";
  const name = (session?.name as string) || "Guest";

  const filteredItems = items.filter(item => {
    if (role === 'HOUSEKEEPING') {
      return ['Housekeeping', 'Maintenance'].includes(item.title);
    }
    if (role === 'FRONT_DESK') {
      return ['Front Desk', 'Reservations', 'Group Blocks', 'Tape Chart', 'Profiles & CRM', 'Housekeeping', 'Maintenance', 'Cashiering', 'Point of Sale', 'Night Audit'].includes(item.title);
    }
    // ADMIN and MANAGER see everything
    return true;
  });

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
                  <span className="text-xs text-slate-500 truncate w-full">{role.replace('_', ' ')}</span>
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
