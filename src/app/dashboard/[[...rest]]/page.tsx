import { redirect } from "next/navigation"
import { requireSession } from "@/lib/scope"
import { prisma } from "@/lib/db"

// Reads live tenant data per request — never prerender. `next build` would otherwise
// run these Prisma queries at build time (failing the Docker build, since no database
// exists then) and freeze the results into static HTML.
export const dynamic = "force-dynamic"

// Backward-compat for any old bare /dashboard/... link (bookmarks, hardcoded
// redirect()s elsewhere in the app) — forwards to the same page under the
// enterprise-scoped /e/{slug}/dashboard/... URL, preserving the sub-path.
export default async function LegacyDashboardRedirect({
  params,
}: {
  params: Promise<{ rest?: string[] }>
}) {
  const { rest } = await params
  const ctx = await requireSession().catch(() => null)
  if (!ctx) redirect("/api/auth/session-expired")

  const enterprise = await prisma.enterprise.findUnique({ where: { id: ctx.enterpriseId } })
  if (!enterprise) redirect("/api/auth/session-expired")

  const subPath = rest && rest.length > 0 ? `/${rest.join("/")}` : ""
  redirect(`/e/${enterprise.slug}/dashboard${subPath}`)
}
