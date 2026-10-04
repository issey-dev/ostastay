import { Suspense } from "react"
import { redirect } from "next/navigation"
import { requireSession, hasPermission } from "@/lib/scope"
import { TransportBoard } from "@/components/transport/transport-board"

// The daily Transportation board (.agents/docs/TRANSPORTATION_PLAN.md). A server shell so the
// board knows which actions the user's role allows (it hides the rest); every API route
// re-checks them. Which property is the dashboard's current one — the board reads it from
// the property provider like every other dashboard page.
export default async function TransportationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ctx = await requireSession().catch(() => null)
  if (!ctx) redirect("/api/auth/session-expired")
  if (!hasPermission(ctx, "TRANSPORTATION", "view")) redirect(`/e/${slug}/dashboard`)
  const perms = {
    manageBookings: hasPermission(ctx, "TRANSPORTATION", "create"),
    manageManifests: hasPermission(ctx, "TRANSPORTATION", "update"),
    canBill: hasPermission(ctx, "TRANSPORTATION", "delete"),
    canVoid: hasPermission(ctx, "CASHIERING", "update"),
  }
  // useUrlState reads the query string — the board needs a Suspense boundary.
  return (
    <Suspense>
      <TransportBoard perms={perms} />
    </Suspense>
  )
}
