import { propertyPage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { ControlsCard } from "@/components/controls/controls-card"
import { SequenceManager } from "@/components/controls/sequence-manager"

export default async function HubPropertySequencesPage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { property, item } = await propertyPage(params, "sequences")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" />
      <ControlsCard title="Sequence Manager" description="This property's current Reservation No, Proforma Folio, Tax Invoice, Receipt No and Guest Registration No (Green Tax). Each is the last number issued — the next document gets the number after it. This manages the plain number only — not prefixes or formatting.">
        <SequenceManager propertyId={property.id} />
      </ControlsCard>
    </div>
  )
}
