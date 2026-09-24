import { redirect } from "next/navigation"
import { requireSession, hasEnterpriseHubAccess } from "@/lib/scope"

// The Hub's ENTERPRISE area — settings shared by every property (see
// .agents/docs/HUB_SETUP_PLAN.md). A single-property user never reaches it, whatever
// their role says: the owner's rule is that enterprise settings are restricted from
// them entirely. Pages still re-check their own module permission, and every API route
// behind them calls requireEnterpriseHub() — this layout protects the pages only.
export default async function EnterpriseHubLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const ctx = await requireSession().catch(() => null)
  if (!ctx) redirect("/api/auth/session-expired")
  if (!hasEnterpriseHubAccess(ctx)) redirect(`/e/${slug}/hub`)
  return children
}
