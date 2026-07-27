import { requireSession, requireHubAccess } from "@/lib/scope"
import { SyncLogViewer } from "@/components/hub/sync-log-viewer"

// Channel-manager exchange log — see .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md.
//
// Deliberately built BEFORE the sync engine so the first sync is debuggable from day one
// rather than a black box.
export default async function ChannelManagerLogsPage() {
  const ctx = await requireSession()
  requireHubAccess(ctx)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Exchange Log</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Every call to and from the channel manager, inbound and outbound. Select a row to see the detail.
        </p>
      </div>

      <SyncLogViewer />
    </div>
  )
}
