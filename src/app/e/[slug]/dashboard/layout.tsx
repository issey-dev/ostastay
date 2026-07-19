import { redirect } from "next/navigation"
import { ShieldAlert } from "lucide-react"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { PropertySwitcher } from "@/components/ui/property-switcher"
import { PropertyProvider } from "@/components/providers/property-provider"
import { PropertyBannerBar } from "@/components/ui/property-banner-bar"
import { SupportSessionNotice } from "@/components/ui/support-session-notice"
import { SupportSessionExitButton } from "@/components/controls/support-session-exit-button"
import { requireSession } from "@/lib/scope"
import { prisma } from "@/lib/db"

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  // App chrome (buttons, links, focus rings) stays a fixed monochrome neutral for every
  // property — see src/app/theme.css. The only per-property color is the thin banner
  // line (PropertyBannerBar), sourced client-side from PropertyProvider so it updates
  // live when the property switcher changes properties, without a full page reload.
  const { slug } = await params
  const ctx = await requireSession().catch(() => null)
  if (!ctx) redirect("/login")

  // The URL's enterprise slug is a display/navigation convenience only — it is never the
  // security boundary (that's always the session, re-checked via requireSession() above
  // on every request regardless of URL). This keeps the slug in the address bar honest:
  // if it doesn't match the session's actual (possibly support-acting-as) enterprise,
  // redirect to the one that does, rather than silently rendering the real data under a
  // misleading URL. Deliberately scoped to /dashboard only — the public /e/[slug]/login
  // page must never require a session, so this check must not live at the [slug] layout
  // level (it used to, and broke logged-out visits to the enterprise login page).
  const enterprise = await prisma.enterprise.findUnique({ where: { id: ctx.enterpriseId }, select: { name: true, slug: true } })
  if (!enterprise) redirect("/login")
  if (enterprise.slug !== slug) redirect(`/e/${enterprise.slug}/dashboard`)

  return (
    <PropertyProvider>
      <SidebarProvider>
        <div className="print:hidden">
          <AppSidebar />
        </div>
        <main className="w-full bg-background min-h-screen flex flex-col overflow-x-hidden print:overflow-visible">

          <div className="print:hidden sticky top-0 z-[var(--z-sticky)] flex flex-col w-full">
            <PropertyBannerBar />

            {ctx?.isActingAsSupport && enterprise && (
              <SupportSessionNotice
                icon={<ShieldAlert className="h-4 w-4 shrink-0" />}
                message={`You are viewing as Osta support, acting as ${enterprise.name}. All actions are logged.`}
                actions={<SupportSessionExitButton />}
              />
            )}

            {/* Glassmorphism Header */}
            <header className="h-16 bg-card/70 backdrop-blur-md flex items-center px-4 w-full shadow-elevation-header gap-4">
              <SidebarTrigger className="text-muted-foreground hover:text-foreground transition-colors" />
              <div>
                <h1 className="font-bold text-lg text-foreground tracking-tight leading-tight">OstaStay</h1>
                {enterprise && <p className="text-xs text-muted-foreground leading-tight">{enterprise.name}</p>}
              </div>
              <PropertySwitcher />
              <div className="ml-auto">
                <ThemeToggle />
              </div>
            </header>
          </div>

          {/* Floating Main Content Area */}
          <div className="flex-1 p-4 md:p-6 lg:p-8 print:p-0">
            <div className="max-w-7xl mx-auto w-full print:max-w-none">
              {children}
            </div>
          </div>
        </main>
      </SidebarProvider>
    </PropertyProvider>
  )
}
