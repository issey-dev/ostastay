import { enterprisePage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { ControlsCard } from "@/components/controls/controls-card"
import {
  DropdownsManager,
  PROFILE_LOV_CATEGORIES,
  RESERVATION_LOV_CATEGORIES,
  OPERATIONS_LOV_CATEGORIES,
  ROOM_FEATURE_LOV_CATEGORIES,
} from "@/components/settings/dropdowns-manager"

// INTERIM (Phase 1 → Phase 3 of .agents/docs/HUB_SETUP_PLAN.md): every dropdown list is
// still one set for the whole enterprise. Reservation, housekeeping and room-feature lists
// move into each property's setup; guest-profile lists stay here (guest profiles are
// shared by every property).
export default async function HubEnterpriseListsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { item } = await enterprisePage(params, "shared-lists")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="interim" />
      <ControlsCard title="Guest Profile Lists" description="Genders, titles, nationalities, dietary requirements and more — used on guest, company and travel-agent profiles.">
        <DropdownsManager categories={PROFILE_LOV_CATEGORIES} />
      </ControlsCard>
      <ControlsCard title="Reservation Lists" description="Special Requests and other reservation-level lists.">
        <DropdownsManager categories={RESERVATION_LOV_CATEGORIES} />
      </ControlsCard>
      <ControlsCard title="Housekeeping Lists" description="Lists used by Housekeeping and Maintenance operations.">
        <DropdownsManager categories={OPERATIONS_LOV_CATEGORIES} />
      </ControlsCard>
      <ControlsCard title="Room Features" description="Bed Type, View and Amenity options offered when configuring a Room Type.">
        <DropdownsManager categories={ROOM_FEATURE_LOV_CATEGORIES} />
      </ControlsCard>
    </div>
  )
}
