import { requireSession, requireHubAccess, hasPermission } from "@/lib/scope"
import { SharingManager } from "@/components/hub/sharing-manager"

// Sharing / mapping — see .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md.
//
// The last piece before the sync engine: which properties are shared, and how this system's
// room types and rate plans correspond to the channel manager's own.
export default async function ChannelManagerSharingPage() {
  const ctx = await requireSession()
  requireHubAccess(ctx)

  const canManage = hasPermission(ctx, "INTEGRATIONS", "update")

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Sharing</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Control what is shared with the channel manager and map it to their room types.
        </p>
      </div>

      <SharingManager canManage={canManage} />
    </div>
  )
}
