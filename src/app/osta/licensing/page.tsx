import { redirect } from "next/navigation"

// Licensing no longer has its own console page (owner, 2026-11-08): a licence, its
// allowances and invoices are managed on the enterprise's Billing tab, and the finance
// overview is /osta/billing. Old links (?enterprise=) land on the right enterprise.
export default async function OstaLicensingRedirect({ searchParams }: { searchParams: Promise<{ enterprise?: string }> }) {
  const { enterprise } = await searchParams
  redirect(enterprise ? `/osta/enterprises/${encodeURIComponent(enterprise)}?tab=billing` : "/osta/billing")
}
