import { redirect } from "next/navigation"
import { requireSession } from "@/lib/scope"
import { ControlsDashboard } from "@/components/controls/controls-dashboard"

export default async function ControlsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ctx = await requireSession().catch(() => null)
  if (!ctx) redirect("/login")

  const canViewControls = ctx.permissions.get("CONTROLS")?.canView ?? false
  if (!canViewControls) redirect(`/e/${slug}/dashboard`)

  return <ControlsDashboard actorScope={ctx.scope} actorPropertyId={ctx.propertyId} />
}
