import { propertyPage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { ExcursionsManager } from "@/components/controls/excursions-manager"

export default async function HubPropertyExcursionsPage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { property, item } = await propertyPage(params, "excursions")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" />
      <ExcursionsManager
        propertyId={property.id}
        title="Excursions"
        description="Activities this property sells to guests from Front Office — catalogue, pricing and recurring schedules."
      />
    </div>
  )
}
