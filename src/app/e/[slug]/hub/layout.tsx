import { redirect } from "next/navigation"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { HubSidebar } from "@/components/hub-sidebar"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { ConfirmProvider } from "@/components/providers/confirm-provider"
import { requireSession, hasHubAccess } from "@/lib/scope"
import { prisma } from "@/lib/db"

// The enterprise Hub — see .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md.
//
// A deliberately separate shell from the property dashboard
// (src/app/e/[slug]/dashboard/layout.tsx), following the same pattern the Osta console
// already uses (src/app/osta/layout.tsx): NO PropertyProvider, no property switcher, no
// property banner, no business date.
//
// That omission is the whole point and is load-bearing, not an oversight. The Hub's rule
// is "zero PMS functionality", and this is what ENFORCES it rather than merely stating
// it: without PropertyProvider in the tree, useProperty() throws, so every
// property-centric component in the codebase fails to mount. A PMS feature cannot be
// added to the Hub by accident — it will not render. Do not add PropertyProvider here.
//
// The Hub may still reference properties as CONFIGURATION objects (which property maps
// to which channel-manager property, which room types are shared) — that is config, not
// operation, and such screens take an explicit propertyId rather than an ambient
// "current property".
export default async function HubLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const ctx = await requireSession().catch(() => null)
  if (!ctx) redirect("/login")

  // Osta users belong in their own console, not a tenant shell — except while
  // legitimately acting inside a tenant's enterprise via an approved SupportAccessGrant.
  // Mirrors the dashboard layout's rule so the two shells behave identically.
  if (ctx.isInternal && !ctx.isActingAsSupport) redirect("/osta")

  // Same honesty rule as the dashboard layout: the URL slug is a display convenience,
  // never the security boundary (that is always the session). If it disagrees with the
  // session's actual enterprise, redirect rather than render real data under a
  // misleading URL.
  const enterprise = await prisma.enterprise.findUnique({
    where: { id: ctx.enterpriseId },
    select: { name: true, slug: true },
  })
  if (!enterprise) redirect("/login")
  if (enterprise.slug !== slug) redirect(`/e/${enterprise.slug}/hub`)

  // Page-level gate. Hub API routes must call requireHubAccess(ctx) themselves — this
  // check protects the UI shell only and is not a substitute for guarding each endpoint.
  if (!hasHubAccess(ctx)) redirect(`/e/${enterprise.slug}/dashboard`)

  return (
    <SidebarProvider>
      <HubSidebar slug={enterprise.slug} />
      <main className="w-full bg-background min-h-screen flex flex-col overflow-x-hidden">
        <header className="h-16 bg-card/70 backdrop-blur-md flex items-center px-4 w-full shadow-elevation-header gap-4 sticky top-0 z-[var(--z-sticky)]">
          <SidebarTrigger className="text-muted-foreground hover:text-foreground transition-colors" />
          <div className="min-w-0">
            <h1 className="font-bold text-lg text-foreground tracking-tight leading-tight truncate">
              {enterprise.name}
            </h1>
            <p className="text-xs text-muted-foreground leading-tight">Enterprise Hub</p>
          </div>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <div className="flex-1 p-4 md:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto w-full">
            <ConfirmProvider>{children}</ConfirmProvider>
          </div>
        </div>
      </main>
    </SidebarProvider>
  )
}
