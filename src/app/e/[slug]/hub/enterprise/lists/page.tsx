import { enterprisePage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { ControlsCard } from "@/components/controls/controls-card"
import {
  DropdownsManager,
  PROFILE_LOV_CATEGORIES,
  STAFF_LOV_CATEGORIES,
} from "@/components/settings/dropdowns-manager"

// The enterprise's own dropdown lists: a guest profile and a user are shared by every
// property, so their lists are too. Every other list (reservation, housekeeping, room
// features) is each property's own — src/lib/system-code-scope.ts.
export default async function HubEnterpriseListsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { item } = await enterprisePage(params, "lists")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="enterprise" />
      <ControlsCard title="Guest Profile Lists" description="Genders, titles, nationalities, dietary requirements and more — used on guest, company and travel-agent profiles at every property.">
        <DropdownsManager categories={PROFILE_LOV_CATEGORIES} />
      </ControlsCard>
      <ControlsCard title="Job Functions" description="Staff posts. Housekeeping and Maintenance decide who can be assigned housekeeping and maintenance work.">
        <DropdownsManager categories={STAFF_LOV_CATEGORIES} />
      </ControlsCard>
    </div>
  )
}
