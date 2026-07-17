import { redirect } from "next/navigation"
import { requireSession } from "@/lib/scope"
import { prisma } from "@/lib/db"

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
  if (!ctx) redirect("/login")

  const enterprise = await prisma.enterprise.findUnique({ where: { id: ctx.enterpriseId } })
  if (!enterprise) redirect("/login")

  const subPath = rest && rest.length > 0 ? `/${rest.join("/")}` : ""
  redirect(`/e/${enterprise.slug}/dashboard${subPath}`)
}
