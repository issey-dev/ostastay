import { propertyPage } from "@/lib/hub-page"
import { hasPermission } from "@/lib/scope"
import { CopyFromPropertyButton } from "@/components/hub/copy-from-property"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { HubSetupNotice } from "@/components/hub/hub-setup-notice"
import { ControlsCard } from "@/components/controls/controls-card"
import { AllocationCalculationManager } from "@/components/controls/allocation-calculation-manager"
import { MealPlansManager } from "@/components/controls/meal-plans-manager"

export default async function HubPropertyRevenuePage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { ctx, property, item, canEdit } = await propertyPage(params, "revenue")
  // The page opens on CONTROLS, but meal plans are saved through /api/meal-plans, which
  // needs REVENUE — so the add/edit/delete actions follow the REVENUE rights.
  const mealPlanPermissions = {
    create: hasPermission(ctx, "REVENUE", "create"),
    update: hasPermission(ctx, "REVENUE", "update"),
    delete: hasPermission(ctx, "REVENUE", "delete"),
  }
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" />
      <HubSetupNotice title={item.title} />
      <ControlsCard title="Allocation calculation" description="Which side drives automatic Allocation attachment on this property's reservations — Meal Plan or Rate Plan. Changing this only affects reservations created or edited afterward, not existing bookings.">
        <AllocationCalculationManager property={property} />
      </ControlsCard>
      <MealPlansManager
        propertyId={property.id}
        copyAction={
          canEdit("create") && (
            <>
              {/* Allocations are managed on the dashboard's Revenue page — this is the Hub's way to copy them. */}
              <CopyFromPropertyButton propertyId={property.id} section="allocations" title="allocations" label="Copy allocations from…" />
              <CopyFromPropertyButton propertyId={property.id} section="meal-plans" title="meal plans" label="Copy meal plans from…" />
            </>
          )
        }
        permissions={mealPlanPermissions}
        title="Meal plans"
        description="Meal plan codes offered on this property's reservations (Bed & Breakfast, Half Board, etc.). A meal plan is priced per person through the Allocations it includes (Revenue > Allocations, e.g. BB → BF), which post at Night Audit when Allocation Calculation is set to Meal Plan level. A code can't be changed or deleted once reservations use it — deactivate it instead."
      />
    </div>
  )
}
