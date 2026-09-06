import { redirect } from "next/navigation"
import { requireSession, hasPermission } from "@/lib/scope"
import { prisma } from "@/lib/db"
import { OperationsDashboard } from "@/components/dashboard/operations-dashboard"

// Reads live tenant data per request — never prerender. See the sibling pages: `next
// build` would otherwise run the session/Prisma lookups at build time, when no database
// exists.
export const dynamic = "force-dynamic"

// The Operations Dashboard. Deliberately a thin server shell: it resolves the enterprise
// prefix for links and hands off to the client component, which reads
// /api/dashboard/overview. Tile visibility is NOT decided here — it is decided by which
// sections that endpoint is willing to return for this session (see
// src/lib/dashboard/overview.ts), so the gate holds for a direct API call too, not just
// for the rendered page.
export default async function DashboardOverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ctx = await requireSession().catch(() => null)
  if (!ctx) redirect("/api/auth/session-expired")

  // The page's own module. Bounced rather than thrown: /dashboard picks whichever screen
  // this session CAN open, so a role without the dashboard lands somewhere useful instead
  // of on an error. (Individual tiles are gated separately — see the note above.)
  if (!hasPermission(ctx, "DASHBOARD", "view")) redirect(`/e/${slug}/dashboard`)

  // The user's name is read here rather than fetched by the client, so the greeting is
  // part of the first paint instead of appearing a moment later.
  const [enterprise, user] = await Promise.all([
    prisma.enterprise.findUnique({ where: { id: ctx.enterpriseId }, select: { slug: true } }),
    prisma.user.findUnique({ where: { id: ctx.userId }, select: { firstName: true, lastName: true } }),
  ])
  if (!enterprise) redirect("/api/auth/session-expired")
  if (enterprise.slug !== slug) redirect(`/e/${enterprise.slug}/dashboard/overview`)

  // A support session acting inside a tenant has no User row in that enterprise; the
  // greeting falls back rather than rendering "Welcome, undefined".
  const userName = user ? `${user.firstName} ${user.lastName}`.trim() : "there"

  return <OperationsDashboard enterprisePrefix={`/e/${enterprise.slug}`} userName={userName} />
}
