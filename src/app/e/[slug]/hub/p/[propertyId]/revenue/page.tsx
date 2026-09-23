import { propertyPage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { ControlsCard } from "@/components/controls/controls-card"
import { AllocationCalculationManager } from "@/components/controls/allocation-calculation-manager"
import { MealPlansManager } from "@/components/controls/meal-plans-manager"

export default async function HubPropertyRevenuePage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { property, item } = await propertyPage(params, "revenue")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" />
      <ControlsCard title="Allocation Calculation" description="Which side drives automatic Allocation attachment on this property's reservations — Meal Plan or Rate Plan. Changing this only affects reservations created or edited afterward, not existing bookings.">
        <AllocationCalculationManager property={property} />
      </ControlsCard>
      <MealPlansManager
        propertyId={property.id}
        title="Meal Plans"
        description="Meal plan codes offered on this property's reservations (Bed & Breakfast, Half Board, etc.). Link each plan to its Allocations (Revenue > Allocations, e.g. BB → BF) for per-person nightly pricing; a Derived Rate Plan remains an option for flat room-rate adjustments."
      />
    </div>
  )
}
