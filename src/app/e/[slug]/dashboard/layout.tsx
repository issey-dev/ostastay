import { redirect } from "next/navigation"
import { ShieldAlert } from "@/components/icons"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { HeaderBrand, HeaderBusinessDate } from "@/components/ui/dashboard-header"
import { PropertyProvider } from "@/components/providers/property-provider"
import { ConfirmProvider } from "@/components/providers/confirm-provider"
import { PropertyBannerBar } from "@/components/ui/property-banner-bar"
import { SupportSessionNotice } from "@/components/ui/support-session-notice"
import { SkipToContent } from "@/components/ui/skip-to-content"
import { EodSessionWatch } from "@/components/providers/eod-session-watch"
import { IdleSessionWatch } from "@/components/providers/idle-session-watch"
import { SupportSessionExitButton } from "@/components/controls/support-session-exit-button"
import { DashboardShell } from "@/components/dashboard-shell"
import { PropertyOnboardingGate } from "@/components/onboarding/property-onboarding-gate"
import { decidePropertyGate } from "@/lib/properties/onboarding-gate"
import { requireSession } from "@/lib/scope"
import { prisma } from "@/lib/db"

// Reads live tenant data per request — never prerender. `next build` would otherwise
// run these Prisma queries at build time (failing the Docker build, since no database
// exists then) and freeze the results into static HTML.
export const dynamic = "force-dynamic"

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  // App chrome (buttons, links, focus rings) is fixed Uppsolut Crimson for every property
  // — see src/app/theme.css. The only per-property color in the chrome is the thin banner
  // line (PropertyBannerBar), sourced client-side from PropertyProvider so it updates
  // live when the property switcher changes properties, without a full page reload.
  // A property's colour also still brands its printed stationery and eRegistration page.
  const { slug } = await params
  const ctx = await requireSession().catch(() => null)
  if (!ctx) redirect("/api/auth/session-expired")

  // Osta users belong in their own console, not the tenant shell — except while
  // legitimately acting inside a tenant's enterprise via an approved SupportAccessGrant.
  if (ctx.isInternal && !ctx.isActingAsSupport) redirect("/osta")

  // The URL's enterprise slug is a display/navigation convenience only — it is never the
  // security boundary (that's always the session, re-checked via requireSession() above
  // on every request regardless of URL). This keeps the slug in the address bar honest:
  // if it doesn't match the session's actual (possibly support-acting-as) enterprise,
  // redirect to the one that does, rather than silently rendering the real data under a
  // misleading URL. Deliberately scoped to /dashboard only — the public /e/[slug]/login
  // page must never require a session, so this check must not live at the [slug] layout
  // level (it used to, and broke logged-out visits to the enterprise login page).
  const enterprise = await prisma.enterprise.findUnique({ where: { id: ctx.enterpriseId }, select: { name: true, slug: true } })
  if (!enterprise) redirect("/api/auth/session-expired")
  if (enterprise.slug !== slug) redirect(`/e/${enterprise.slug}/dashboard`)

  // Property onboarding gate. Every dashboard page is built around a current property —
  // they all wait on PropertyProvider's `currentProperty` — so a session with no ACTIVE
  // property renders pages that never finish loading. That looked broken; this states
  // the real situation instead, and covers every route at once by living in the layout.
  //
  // Support sessions are exempt: Osta acting inside a tenant may legitimately need to
  // see a pending property's setup, the same carve-out assertPropertyAccess() makes.
  const properties = ctx.isActingAsSupport
    ? []
    : await prisma.property.findMany({
        where: ctx.scope === "PROPERTY" ? { id: ctx.propertyId ?? "" } : { enterpriseId: ctx.enterpriseId },
        select: { id: true, name: true, code: true, status: true, rejectionReason: true },
        orderBy: { createdAt: "asc" },
      })

  const gate = decidePropertyGate({
    isActingAsSupport: ctx.isActingAsSupport,
    properties,
    scope: ctx.scope,
    canCreateControls: ctx.permissions.get("CONTROLS")?.canCreate ?? false,
  })

  if (gate.blocked) {
    return (
      <PropertyOnboardingGate
        enterpriseName={enterprise.name}
        properties={properties}
        state={gate.state}
        // Drives the resubmit button in the AWAITING state too, so this is the real
        // permission rather than something derived from the state.
        canManage={ctx.scope === "ENTERPRISE" && (ctx.permissions.get("CONTROLS")?.canCreate ?? false)}
      />
    )
  }

  // Both trees are built here, server-side, and handed to DashboardShell (a small
  // client component) to pick between via usePathname() — stationery documents
  // (Invoice, Receipts, Registration Card, Confirmation Letter, Statement) render
  // chrome-free on screen, not just during @media print. AppSidebar and friends must
  // stay inside a Server Component's own JSX rather than be imported by a "use client"
  // file: they transitively depend on next/headers/Prisma, which Next.js cannot bundle
  // into a client component.
  const loginPath = `/e/${enterprise.slug}/login`

  const chrome = (
    <PropertyProvider>
      <SidebarProvider>
        {/* First focusable element in the shell — must stay ahead of AppSidebar. */}
        <SkipToContent />
        <div className="print:hidden">
          <AppSidebar />
        </div>
        <main id="main-content" tabIndex={-1} className="w-full bg-background min-h-screen flex flex-col overflow-x-hidden print:overflow-visible outline-none">

          <div className="print:hidden sticky top-0 z-[var(--z-sticky)] flex flex-col w-full">
            <PropertyBannerBar />

            {/* Announces an in-progress End-of-Day roll on the property this session is
                working in, then signs the user out when the date actually rolls. */}
            <EodSessionWatch loginPath={loginPath} />
            {/* Ends the session after this property's configured idle timeout — a local
                clock in the browser, not another background poll. See the component. */}
            <IdleSessionWatch loginPath={loginPath} />

            {ctx?.isActingAsSupport && (
              <SupportSessionNotice
                icon={<ShieldAlert className="h-4 w-4 shrink-0" />}
                message={`You are viewing as Osta support, acting as ${enterprise.name}. All actions are logged.`}
                actions={<SupportSessionExitButton />}
              />
            )}

            {/* Glassmorphism Header */}
            <header className="h-16 bg-card/70 backdrop-blur-md flex items-center px-4 w-full shadow-elevation-header gap-4">
              <SidebarTrigger className="text-muted-foreground hover:text-foreground transition-colors" />
              <HeaderBrand enterpriseName={enterprise.name} />
              <div className="ml-auto flex items-center gap-4">
                <HeaderBusinessDate />
                <ThemeToggle />
              </div>
            </header>
          </div>

          {/* Floating Main Content Area */}
          <div className="flex-1 p-4 md:p-6 lg:p-8 print:p-0">
            <div className="max-w-7xl mx-auto w-full print:max-w-none">
              <ConfirmProvider>{children}</ConfirmProvider>
            </div>
          </div>
        </main>
      </SidebarProvider>
    </PropertyProvider>
  )

  const bare = (
    <PropertyProvider>
      <ConfirmProvider>
        <EodSessionWatch loginPath={loginPath} />
        <IdleSessionWatch loginPath={loginPath} />
        {children}
      </ConfirmProvider>
    </PropertyProvider>
  )

  return <DashboardShell chrome={chrome} bare={bare} />
}
