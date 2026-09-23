import { propertyPage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { ControlsCard } from "@/components/controls/controls-card"
import { FeeRulesManager } from "@/components/controls/fee-rules-manager"

export default async function HubPropertyFinancePage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { property, item } = await propertyPage(params, "finance")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" />
      <ControlsCard title="Deposit & Fee Rules" description="This property's Deposit, Cancellation and No-Show fee rules. The amount can be flat, a percentage of the stay, the first night, or the full stay. Cancellation fees are prompted on cancel; no-show fees apply at Night Audit — both collected via the Deposit module, never billing.">
        <FeeRulesManager propertyId={property.id} />
      </ControlsCard>
    </div>
  )
}
