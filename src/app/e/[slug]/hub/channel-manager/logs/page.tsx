import { requireSession, requireHubAccess } from "@/lib/scope"
import { SyncLogViewer } from "@/components/hub/sync-log-viewer"
import { InfoHint } from "@/components/ui/info-hint"

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
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            Exchange Log
            <InfoHint label="Exchange Log">Every call to and from the channel manager, inbound and outbound. Select a row to see the detail.</InfoHint>
          </h2>
      </div>

      <SyncLogViewer />
    </div>
  )
}
