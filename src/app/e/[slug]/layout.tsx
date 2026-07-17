import { redirect } from "next/navigation"
import { requireSession } from "@/lib/scope"
import { prisma } from "@/lib/db"

// The URL's enterprise slug is a display/navigation convenience only — it is never the
// security boundary (that's always the session, enforced by requireSession() on every
// page/route regardless of URL). This layout's only job is to keep the slug in the
// address bar honest: if it doesn't match the session's actual (possibly
// support-acting-as) enterprise, redirect to the one that does, rather than silently
// rendering the real data under a misleading URL.
export default async function EnterpriseLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const ctx = await requireSession().catch(() => null)
  if (!ctx) redirect("/login")

  const enterprise = await prisma.enterprise.findUnique({ where: { id: ctx.enterpriseId } })
  if (!enterprise) redirect("/login")

  if (enterprise.slug !== slug) {
    redirect(`/e/${enterprise.slug}/dashboard`)
  }

  return children
}
