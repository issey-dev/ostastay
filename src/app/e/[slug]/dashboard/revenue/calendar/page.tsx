"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams, useParams } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { RateCalendar } from "@/components/revenue/rate-calendar"
import { useProperty } from "@/components/providers/property-provider"

export default function PriceCalendarPage() {
  return (
    <Suspense fallback={null}>
      <PriceCalendarPageContent />
    </Suspense>
  )
}

// Reached from a rate plan's "Calendar" button: the calendar is pinned to that plan (it can't
// be switched to another rate from here — the Calendar tab on Revenue is the filterable one).
// Without ?ratePlanId= it falls back to the same view as that tab. Read only; prices are
// changed in Rate seasons.
function PriceCalendarPageContent() {
  const searchParams = useSearchParams()
  const { slug } = useParams<{ slug: string }>()
  const ratePlanId = searchParams.get("ratePlanId")
  const { currentProperty } = useProperty()
  const propertyId = currentProperty?.id ?? ""
  const [plan, setPlan] = useState<{ code: string; name: string } | null>(null)

  useEffect(() => {
    if (!propertyId || !ratePlanId) return
    fetch(`/api/rate-plans?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((plans) => setPlan(Array.isArray(plans) ? plans.find((p: { id: string }) => p.id === ratePlanId) ?? null : null))
      .catch(() => setPlan(null))
  }, [propertyId, ratePlanId])

  const returnPath = `/e/${slug}/dashboard/revenue/calendar${ratePlanId ? `?ratePlanId=${ratePlanId}` : ""}`

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        {/* Phones only: the breadcrumb is the way back on desktop. */}
        <Link href={`/e/${slug}/dashboard/revenue?tab=rate-plans`} className="md:hidden">
          <Button variant="outline" size="icon" aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <PageHeader
          className="flex-1"
          crumb={plan?.code ?? null}
          title="Price calendar"
          tabTitle={plan ? `Price calendar · ${plan.code}` : "Price calendar"}
          hint={plan ? `Daily rates for ${plan.name} by room type. View only — change prices in Rate seasons.` : "Daily rates by room type. View only — change prices in Rate seasons."}
        />
      </div>
      <RateCalendar lockedRatePlanId={ratePlanId} returnPath={returnPath} />
    </div>
  )
}
