import { propertyPage } from "@/lib/hub-page"
import { CopyFromPropertyButton } from "@/components/hub/copy-from-property"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { StationariesManager } from "@/components/settings/stationaries-manager"

export default async function HubPropertyStationeryPage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { property, item, canEdit } = await propertyPage(params, "stationery")
  return (
    <div className="space-y-6">
      <HubPageHeader
        title={item.title}
        icon={item.icon}
        scope="property"
        hint="The wording on this property's invoices, receipts, confirmation letter, registration card, statements and eRegistration — with a live preview in this property's own branding."
      >
        {canEdit("create") && <CopyFromPropertyButton propertyId={property.id} section="stationery" title="stationery wording" />}
      </HubPageHeader>
      <StationariesManager propertyId={property.id} />
    </div>
  )
}
