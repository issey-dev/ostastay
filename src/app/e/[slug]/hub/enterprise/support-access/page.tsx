import { enterprisePage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { ControlsCard } from "@/components/controls/controls-card"
import { SupportAccessManager } from "@/components/controls/support-access-manager"

export default async function HubEnterpriseSupportAccessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { item } = await enterprisePage(params, "support-access")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="enterprise" />
      <ControlsCard title="Support Access" description="Uppsolut support staff have no implicit access to your data — they must request it here, and you decide whether to approve it.">
        <SupportAccessManager isInternal={false} />
      </ControlsCard>
    </div>
  )
}
