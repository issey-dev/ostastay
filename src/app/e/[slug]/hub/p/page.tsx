import { redirect } from "next/navigation"
import { requireSession } from "@/lib/scope"
import { resolveHubPropertyId } from "@/lib/hub-properties"

// /hub/p with no property — open the last property configured here, else the one the
// user is working in, else the first they may open. The property always ends up in the
// URL; nothing downstream reads an ambient "current property".
export default async function HubPropertyIndexPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ctx = await requireSession()
  const propertyId = await resolveHubPropertyId(ctx)
  if (propertyId) redirect(`/e/${slug}/hub/p/${propertyId}`)

  // Rendered rather than redirected so there is no loop with the Overview.
  return (
    <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
      There is no active property you can set up yet. A new property becomes available here
      once it has been approved.
    </div>
  )
}
