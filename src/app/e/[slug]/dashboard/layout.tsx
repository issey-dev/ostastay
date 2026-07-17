import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { PropertySwitcher } from "@/components/ui/property-switcher"
import { PropertyProvider } from "@/components/providers/property-provider"
import { requireSession } from "@/lib/scope"
import { prisma } from "@/lib/db"
import { resolveThemeColorPreset } from "@/lib/themePresets"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Applies this enterprise's chosen Primary Color (Controls > General) on top of
  // whichever light/dark mode is active — scoped to the dashboard only, never the
  // public login pages. Failing open to the default preset if the session can't be
  // resolved here keeps this a pure UX layer, not a security boundary.
  const ctx = await requireSession().catch(() => null)
  const [settings, enterprise] = ctx
    ? await Promise.all([
        prisma.enterpriseSettings.findUnique({ where: { enterpriseId: ctx.enterpriseId } }),
        prisma.enterprise.findUnique({ where: { id: ctx.enterpriseId }, select: { name: true } }),
      ])
    : [null, null]
  const preset = resolveThemeColorPreset(settings?.themeColor)

  return (
    <PropertyProvider>
      <SidebarProvider>
        <style
          dangerouslySetInnerHTML={{
            __html: `:root, .dark { --primary: ${preset.primary}; --primary-foreground: ${preset.primaryForeground}; --ring: ${preset.primary}; --sidebar-primary: ${preset.primary}; --sidebar-ring: ${preset.primary}; }`,
          }}
        />
        <AppSidebar />
        <main className="w-full bg-[#F8FAFC] dark:bg-slate-950 min-h-screen flex flex-col overflow-x-hidden">

          {/* Glassmorphism Header */}
          <header className="h-16 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md sticky top-0 z-10 flex items-center px-4 w-full shadow-[0_1px_3px_0_rgba(0,0,0,0.02)] gap-4">
            <SidebarTrigger className="text-slate-500 hover:text-indigo-600 transition-colors" />
            <div>
              <h1 className="font-bold text-lg text-slate-800 dark:text-slate-100 font-outfit tracking-tight leading-tight">Guest House PMS</h1>
              {enterprise && <p className="text-xs text-slate-500 dark:text-slate-400 leading-tight">{enterprise.name}</p>}
            </div>
            <PropertySwitcher />
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </header>

          {/* Floating Main Content Area */}
          <div className="flex-1 p-4 md:p-8">
            <div className="max-w-7xl mx-auto w-full">
              {children}
            </div>
          </div>
        </main>
      </SidebarProvider>
    </PropertyProvider>
  )
}
