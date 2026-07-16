import { redirect } from "next/navigation"
import { requireSession } from "@/lib/scope"
import { ControlsDashboard } from "@/components/controls/controls-dashboard"

export default async function ControlsPage() {
  const ctx = await requireSession().catch(() => null)
  if (!ctx) redirect("/login")

  const canViewControls = ctx.permissions.get("CONTROLS")?.canView ?? false
  if (!canViewControls) redirect("/dashboard")

  return <ControlsDashboard isInternal={ctx.isInternal} />
}
