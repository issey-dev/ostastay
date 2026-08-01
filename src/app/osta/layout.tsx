import { redirect } from "next/navigation"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { OstaSidebar } from "@/components/osta-sidebar"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { SkipToContent } from "@/components/ui/skip-to-content"
import { requireSession } from "@/lib/scope"
import { prisma } from "@/lib/db"

// The Osta platform-admin console — a completely separate shell from the tenant
// dashboard (src/app/e/[slug]/dashboard/layout.tsx): no PropertyProvider/property
// switcher/banner, since Osta has no operational property of its own. Only reachable
// by users whose home enterprise IS Osta (ctx.isInternal) — everyone else bounces to
// their own tenant dashboard.
export default async function OstaLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSession().catch(() => null)
  if (!ctx) redirect("/login")

  if (!ctx.isInternal) {
    const enterprise = await prisma.enterprise.findUnique({ where: { id: ctx.enterpriseId }, select: { slug: true } })
    redirect(enterprise ? `/e/${enterprise.slug}/dashboard` : "/login")
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
      <main id="main-content" tabIndex={-1} className="w-full bg-background min-h-screen flex flex-col overflow-x-hidden print:overflow-visible outline-none">
        <header className="print:hidden h-16 bg-card/70 backdrop-blur-md flex items-center px-4 w-full shadow-elevation-header gap-4 sticky top-0 z-[var(--z-sticky)]">
          <SidebarTrigger className="text-muted-foreground hover:text-foreground transition-colors" />
          <div>
            <h1 className="font-bold text-lg text-foreground tracking-tight leading-tight">OstaStay</h1>
            <p className="text-xs text-muted-foreground leading-tight">Osta Platform Admin</p>
          </div>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <div className="flex-1 p-4 md:p-6 lg:p-8 print:p-0">
          <div className="max-w-7xl mx-auto w-full print:max-w-none">
            {children}
          </div>
        </div>
      </main>
    </SidebarProvider>
  )
}
