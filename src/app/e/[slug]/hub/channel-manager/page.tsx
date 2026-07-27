import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { requireSession } from "@/lib/scope"

// Placeholder. The Hub shell ships first and deliberately carries no channel-manager
// code — see .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md ("Recommended build order").
// The three real screens land next, in this order:
//   1. Connection — Beds24 credentials (encrypted at rest via src/lib/secret-crypto.ts),
//      token refresh, connection health.
//   2. Logs — built BEFORE the sync engine, so the first sync is debuggable on day one.
//   3. Sharing — property links plus room-type / rate-plan mapping.
export default async function ChannelManagerPage() {
  await requireSession()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Channel Manager</h2>
        <p className="text-sm text-muted-foreground mt-1">
          The exchange interface between this enterprise and the booking channels.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Not connected</CardTitle>
          <CardDescription>
            No channel-manager connection has been configured yet. Connection setup, sharing
            controls and sync logs will appear here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            See <code className="text-xs">.agents/docs/HUB_CHANNEL_MANAGER_PLAN.md</code> for the
            rollout plan.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
