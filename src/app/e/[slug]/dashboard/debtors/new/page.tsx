"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import ProfileForm from "@/components/profiles/ProfileForm"

function DebtorAccountFormWrapper() {
  const searchParams = useSearchParams()
  const type = searchParams.get("type") || "COMPANY"
  return <ProfileForm defaultType={type} contextMode="debtor" />
}

export default function NewDebtorAccountPage() {
  return (
    <div className="container mx-auto p-4 md:p-8">
      <Suspense fallback={<div className="p-8 text-center">Loading...</div>}>
        <DebtorAccountFormWrapper />
      </Suspense>
    </div>
  )
}
