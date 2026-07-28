import { requireSession, requireHubAccess, hasPermission } from "@/lib/scope"
import { ChannelConnectionManager } from "@/components/hub/channel-connection-manager"

// Channel Manager — the exchange interface between this enterprise and the booking
// channels. See .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md.
//
// Ships in the plan's order: Connection first (this screen), then Logs — deliberately
// BEFORE the sync engine, so the first sync is debuggable — then Sharing/mapping.
export default async function ChannelManagerPage() {
  const ctx = await requireSession()
  // The Hub layout already gated the shell; re-asserting here keeps the page honest on
  // its own terms rather than relying on an ancestor for authorization.
  requireHubAccess(ctx)

  // View-only users see the connection's health but none of the mutating controls. The
  // API enforces this independently — this only avoids showing buttons that would 403.
  const canManage = hasPermission(ctx, "INTEGRATIONS", "update")

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Channel Manager</h2>
        <p className="text-sm text-muted-foreground mt-1">
          The exchange interface between this enterprise and the booking channels.
        </p>
      </div>

      <ChannelConnectionManager canManage={canManage} />
    </div>
  )
}
