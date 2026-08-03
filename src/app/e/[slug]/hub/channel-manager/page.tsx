import { requireSession, requireHubAccess, hasPermission } from "@/lib/scope"
import { ChannelConnectionStatus } from "@/components/hub/channel-connection-status"
import { InfoHint } from "@/components/ui/info-hint"

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

  // Only gates the health-check button now — establishing the link is an Osta action and
  // is refused by the API for every tenant regardless of permission (see
  // src/app/api/hub/connections/route.ts).
  const canManage = hasPermission(ctx, "INTEGRATIONS", "update")

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            Channel Manager
            <InfoHint label="Channel Manager">The exchange interface between this enterprise and the booking channels.</InfoHint>
          </h2>
      </div>

      <ChannelConnectionStatus canManage={canManage} />
    </div>
  )
}
