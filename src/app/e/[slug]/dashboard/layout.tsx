import { redirect } from "next/navigation"
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
  if (!ctx) redirect("/login")

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
  if (!enterprise) redirect("/login")
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

  return (
    <DashboardShell
      enterpriseName={enterprise.name}
      enterpriseSlug={enterprise.slug}
      isActingAsSupport={!!ctx?.isActingAsSupport}
    >
      {children}
    </DashboardShell>
  )
}
