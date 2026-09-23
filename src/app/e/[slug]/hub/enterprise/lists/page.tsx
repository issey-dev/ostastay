import { enterprisePage } from "@/lib/hub-page"
import { hasPermission } from "@/lib/scope"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { ControlsCard } from "@/components/controls/controls-card"
import { DropdownsManager, PROFILE_LOV_CATEGORIES } from "@/components/settings/dropdowns-manager"
import { NationalitiesManager } from "@/components/settings/nationalities-manager"

// The enterprise's own guest lists — a guest profile is shared by every property, so its
// lists are too. Nationalities come ready-made from the ISO master list (the enterprise only
// renames or adds); every other property list is that property's own
// (src/lib/system-code-scope.ts).
export default async function HubEnterpriseListsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { ctx, item } = await enterprisePage(params, "lists")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="enterprise" />
      <ControlsCard title="Nationalities" description="Every country's nationality, with its flag, used for guests' nationality, address country and document issuing country at every property.">
        <NationalitiesManager canEdit={hasPermission(ctx, "CONTROLS", "update")} />
      </ControlsCard>
      <ControlsCard title="Guest Profile Lists" description="Genders, titles, ID types, dietary requirements and more — used on guest, company and travel-agent profiles at every property.">
        <DropdownsManager categories={PROFILE_LOV_CATEGORIES} />
      </ControlsCard>
    </div>
  )
}
