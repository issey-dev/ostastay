import { redirect } from "next/navigation"

// The old "Housekeeping Operations" screen was never in the sidebar and overlapped
// Housekeeping and Maintenance. Owner decision (DECISIONS 2026-09-25 "Desktop polish"):
// any old link or bookmark lands on Housekeeping.
export default async function InventoryRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  redirect(`/e/${slug}/dashboard/housekeeping`)
}
