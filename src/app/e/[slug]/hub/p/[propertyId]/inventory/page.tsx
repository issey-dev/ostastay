import { propertyPage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { ControlsCard } from "@/components/controls/controls-card"
import { FacilitiesManager } from "@/components/settings/facilities-manager"
import { DropdownsManager, ROOM_FEATURE_LOV_CATEGORIES } from "@/components/settings/dropdowns-manager"

export default async function HubPropertyInventoryPage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { property, item } = await propertyPage(params, "inventory")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" />
      <ControlsCard title="Property Architecture" description="This property's room types, buildings, floors and rooms.">
        <FacilitiesManager propertyId={property.id} />
      </ControlsCard>
      <ControlsCard title="Room Features" description="The bed type, view and amenity options this property's room types and rooms choose from.">
        <DropdownsManager categories={ROOM_FEATURE_LOV_CATEGORIES} propertyId={property.id} />
      </ControlsCard>
    </div>
  )
}
