import { ShieldAlert } from "lucide-react"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { PropertySwitcher } from "@/components/ui/property-switcher"
import { PropertyProvider } from "@/components/providers/property-provider"
import { EnterpriseBanner } from "@/components/ui/enterprise-banner"
import { SupportSessionExitButton } from "@/components/controls/support-session-exit-button"
import { requireSession } from "@/lib/scope"
import { prisma } from "@/lib/db"
import { resolveThemeColorPreset } from "@/lib/themePresets"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Resolves this enterprise's chosen accent (Controls > General) into the reserved
  // --accent-enterprise slot only — never --primary/--ring/--sidebar-primary. --primary
  // stays a fixed neutral everywhere (monochromatic app chrome); --accent-enterprise is
  // consumed exclusively by EnterpriseBanner (see src/components/ui/enterprise-banner.tsx
  // and DESIGN_PLAN.md §3.3). Scoped to the dashboard only, never the public login pages.
  // Failing open to the default preset if the session can't be resolved here keeps this
  // a pure UX layer, not a security boundary.
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
            __html: `:root, .dark { --accent-enterprise: ${preset.primary}; --accent-enterprise-foreground: ${preset.primaryForeground}; }`,
          }}
        />
        <AppSidebar />
        <main className="w-full bg-background min-h-screen flex flex-col overflow-x-hidden">

          <div className="sticky top-0 z-[var(--z-sticky)] flex flex-col w-full">
            {ctx?.isActingAsSupport && enterprise && (
              <EnterpriseBanner
                icon={<ShieldAlert className="h-4 w-4 shrink-0" />}
                message={`You are viewing as Osta support, acting as ${enterprise.name}. All actions are logged.`}
                actions={<SupportSessionExitButton />}
              />
            )}

            {/* Glassmorphism Header */}
            <header className="h-16 bg-card/70 backdrop-blur-md flex items-center px-4 w-full shadow-elevation-header gap-4">
              <SidebarTrigger className="text-muted-foreground hover:text-foreground transition-colors" />
              <div>
                <h1 className="font-bold text-lg text-foreground tracking-tight leading-tight">Guest House PMS</h1>
                {enterprise && <p className="text-xs text-muted-foreground leading-tight">{enterprise.name}</p>}
              </div>
              <PropertySwitcher />
              <div className="ml-auto">
                <ThemeToggle />
              </div>
            </header>
          </div>

          {/* Floating Main Content Area */}
          <div className="flex-1 p-4 md:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto w-full">
              {children}
            </div>
          </div>
        </main>
      </SidebarProvider>
    </PropertyProvider>
  )
}
