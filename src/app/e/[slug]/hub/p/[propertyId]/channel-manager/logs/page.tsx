import { propertyPage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { HubSetupNotice } from "@/components/hub/hub-setup-notice"
import { SyncLogViewer } from "@/components/hub/sync-log-viewer"

// This property's channel-manager exchange log — every call to and from the channel
// manager for this property, inbound and outbound.
export default async function HubPropertyChannelLogsPage({ params }: { params: Promise<{ slug: string; propertyId: string }> }) {
  const { property, item } = await propertyPage(params, "channel-logs")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="property" hint="Every call to and from the channel manager for this property. Select a row to see the detail." />
      <HubSetupNotice title={item.title} />
      <SyncLogViewer propertyId={property.id} />
    </div>
  )
}
