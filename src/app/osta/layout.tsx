import { redirect } from "next/navigation"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { OstaSidebar } from "@/components/osta-sidebar"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { SkipToContent } from "@/components/ui/skip-to-content"
import { ConfirmProvider } from "@/components/providers/confirm-provider"
import { InfoHint } from "@/components/ui/info-hint"
import { UppsolutWordmark } from "@/components/brand/uppsolut-logo"
import { OstaHeaderTools } from "@/components/osta/osta-header-tools"
import { NotificationBell } from "@/components/notifications/notification-bell"
import { requireSession } from "@/lib/scope"
import { prisma } from "@/lib/db"

// Reads live tenant data per request — never prerender. `next build` would otherwise
// run these Prisma queries at build time (failing the Docker build, since no database
// exists then) and freeze the results into static HTML.
export const dynamic = "force-dynamic"

// The Osta platform-admin console — a completely separate shell from the tenant
// dashboard (src/app/e/[slug]/dashboard/layout.tsx): no PropertyProvider/property
// switcher/banner, since Osta has no operational property of its own. Only reachable
// by users whose home enterprise IS Osta (ctx.isInternal) — everyone else bounces to
// their own tenant dashboard.
export default async function OstaLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSession().catch(() => null)
  if (!ctx) redirect("/api/auth/session-expired")

  if (!ctx.isInternal) {
    const enterprise = await prisma.enterprise.findUnique({ where: { id: ctx.enterpriseId }, select: { slug: true } })
    redirect(enterprise ? `/e/${enterprise.slug}/dashboard` : "/api/auth/session-expired")
  }

  return (
    <SidebarProvider>
      {/* First focusable element in the shell — must stay ahead of OstaSidebar. */}
      <SkipToContent />
      {/* print:hidden mirrors the tenant dashboard layout — the license-invoice print
          page (/osta/license-invoices/[id]/print) lives inside this shell, and the
          sidebar/header must not appear on the printed document. */}
      <div className="print:hidden">
        <OstaSidebar />
      </div>
      <main id="main-content" tabIndex={-1} className="w-full min-w-0 bg-background min-h-screen max-md:min-h-dvh flex flex-col overflow-x-clip print:overflow-visible outline-none">
        <header className="print:hidden h-16 bg-card/70 backdrop-blur-md flex items-center px-4 w-full shadow-elevation-header gap-4 sticky top-0 z-[var(--z-sticky)]">
          {/* Phones open the menu from the bottom nav's "More", so no duplicate toggle here. */}
          <SidebarTrigger className="text-muted-foreground hover:text-foreground transition-colors max-md:hidden" />
          <div className="min-w-0">
            {/* The plain wordmark, not the Stay lockup: this console administers every
                module and every tenant, so it is not branded to one sub-brand. Not a
                heading: the page title is the page's only <h1>. */}
            <div className="flex items-center gap-2.5 text-foreground leading-none">
            <UppsolutWordmark className="h-[15px] w-auto" />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground max-sm:hidden">Platform admin</span>
            <InfoHint className="max-sm:hidden" label="Uppsolut Platform Admin">The Osta platform console — manages customer enterprises, licensing, and channel-manager connections across every property on Uppsolut.</InfoHint>
          </div>
          </div>
          <div className="ml-auto flex items-center gap-1 sm:gap-2 print:hidden">
            {/* Search (Ctrl+K palette) and the + New menu; also mounts both overlays. */}
            <OstaHeaderTools />
            <NotificationBell allHref="/osta/notifications" />
            <ThemeToggle />
          </div>
        </header>
        {/* Phones: room at the bottom for the bottom nav (and the home indicator). */}
        <div className="flex-1 p-4 md:p-6 lg:p-8 print:p-0 max-md:pb-[calc(5rem+env(safe-area-inset-bottom))]">
          <div className="max-w-7xl mx-auto w-full print:max-w-none">
            {/* Same confirm-dialog provider the tenant shells mount — Osta pages with
                destructive actions (Channel Manager's remove/replace-URL) need it too. */}
            <ConfirmProvider>{children}</ConfirmProvider>
          </div>
        </div>
      </main>
    </SidebarProvider>
  )
}
