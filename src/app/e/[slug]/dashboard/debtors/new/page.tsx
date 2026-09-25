"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import ProfileForm from "@/components/profiles/ProfileForm"
import { DashboardBreadcrumbs } from "@/components/shell/dashboard-breadcrumbs"
import { DocumentTitle } from "@/components/ui/document-title"

function DebtorAccountFormWrapper() {
  const searchParams = useSearchParams()
  const type = searchParams.get("type") || "COMPANY"
  return <ProfileForm defaultType={type} contextMode="debtor" />
}

// The shared ProfileForm renders this page's title row itself (with its sticky Save/Cancel),
// so only the breadcrumb and the browser-tab title are added here — a PageHeader would show
// the title twice. No padding/max-width of its own: the dashboard layout provides both.
export default function NewDebtorAccountPage() {
  return (
    <div className="space-y-2">
      <DocumentTitle title="New credit account · Debtors" />
      <DashboardBreadcrumbs current="New account" />
      <Suspense fallback={<div className="p-8 text-center">Loading...</div>}>
        <DebtorAccountFormWrapper />
      </Suspense>
    </div>
  )
}
