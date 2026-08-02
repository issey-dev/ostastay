import { requireSession, hasPermission } from "@/lib/scope"
import { ChannelConnectionsAdmin } from "@/components/osta/channel-connections-admin"

// Cross-tenant channel-manager administration — the master-account topology's control
// room (.agents/docs/DECISIONS.md, 2026-08-02). The Osta layout already bounced anyone
// who isn't internal; the API routes re-assert isInternal independently, so this page's
// only own decision is whether to render the mutating controls.
export default async function OstaChannelManagerPage() {
  const ctx = await requireSession()
  const canManage = hasPermission(ctx, "INTEGRATIONS", "update")

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Channel Manager</h2>
        <p className="text-muted-foreground">
          Every enterprise&rsquo;s Beds24 connection, run from the master account: setup, health, webhooks and the
          shared rate-limit pool. Room and rate mapping stays in each enterprise&rsquo;s own Hub.
        </p>
      </div>
      <ChannelConnectionsAdmin canManage={canManage} />
    </div>
  )
}
