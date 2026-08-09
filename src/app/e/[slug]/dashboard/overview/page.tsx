import { redirect } from "next/navigation"
import { requireSession } from "@/lib/scope"
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
  if (!ctx) redirect("/login")

  const enterprise = await prisma.enterprise.findUnique({ where: { id: ctx.enterpriseId }, select: { slug: true } })
  if (!enterprise) redirect("/login")
  if (enterprise.slug !== slug) redirect(`/e/${enterprise.slug}/dashboard/overview`)

  return <OperationsDashboard enterprisePrefix={`/e/${enterprise.slug}`} />
}
