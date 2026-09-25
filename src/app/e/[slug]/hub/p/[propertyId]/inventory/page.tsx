import { propertyPage } from "@/lib/hub-page"
import { CopyFromPropertyButton } from "@/components/hub/copy-from-property"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { HubSetupNotice } from "@/components/hub/hub-setup-notice"
import { ControlsCard } from "@/components/controls/controls-card"
import { FacilitiesManager } from "@/components/settings/facilities-manager"
import { PropertySwitchSetting } from "@/components/hub/night-audit-settings"
import { prisma } from "@/lib/db"
import { DropdownsManager, ROOM_FEATURE_LOV_CATEGORIES } from "@/components/settings/dropdowns-manager"

export default async function HubPropertyInventoryPage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { property, item, canEdit } = await propertyPage(params, "inventory")
  const { requireInspectionOnCheckIn } = await prisma.property.findUniqueOrThrow({ where: { id: property.id }, select: { requireInspectionOnCheckIn: true } })
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" />
      <HubSetupNotice title={item.title} />
      <ControlsCard
        title="Property Architecture"
        description="This property's room types, buildings, floors and rooms. Copying brings room types (with their features) — rooms are physical, and each property builds its own."
        action={canEdit("create") && <CopyFromPropertyButton propertyId={property.id} section="room-types" title="room types" />}
      >
        <FacilitiesManager propertyId={property.id} />
      </ControlsCard>
      <ControlsCard title="Housekeeping" description="How housekeeping status gates arrivals at this property.">
        <PropertySwitchSetting
          propertyId={property.id}
          field="requireInspectionOnCheckIn"
          label="Require Inspected Room at Check-In"
          initial={requireInspectionOnCheckIn}
          canEdit={canEdit("update")}
          description="On: guests can only be checked into rooms housekeeping has marked Inspected — a supervisor must sign off each room before an arrival. Off: a dirty room warns but doesn't block."
        />
      </ControlsCard>
      <ControlsCard
        title="Room Features"
        description="The bed type, view and amenity options this property's room types and rooms choose from."
        action={canEdit("create") && (
          <CopyFromPropertyButton
            propertyId={property.id}
            section="lists"
            title="room-feature lists"
            keyPrefixes={["BED_TYPE:", "ROOM_VIEW:", "ROOM_AMENITY:"]}
          />
        )}
      >
        <DropdownsManager categories={ROOM_FEATURE_LOV_CATEGORIES} propertyId={property.id} />
      </ControlsCard>
    </div>
  )
}
