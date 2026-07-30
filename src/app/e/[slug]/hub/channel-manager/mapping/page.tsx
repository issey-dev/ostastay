import { requireSession, requireHubAccess, hasPermission } from "@/lib/scope"
import { MappingManager } from "@/components/hub/mapping-manager"

// Mapping (formerly "Sharing") — see .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md.
//
// Which properties are shared with the channel manager, how this system's room types and
// rate plans correspond to theirs, on-demand availability/price resyncs for a chosen date
// range, and the defaults used to fill in what an inbound booking doesn't say.
export default async function ChannelManagerMappingPage() {
  const ctx = await requireSession()
  requireHubAccess(ctx)

  const canManage = hasPermission(ctx, "INTEGRATIONS", "update")

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Mapping</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Control what is shared with the channel manager and map it to their room types, rates, and defaults.
        </p>
      </div>

      <MappingManager canManage={canManage} />
    </div>
  )
}
