import { requireSession, hasPermission } from "@/lib/scope"
import { ChannelConnectionsAdmin } from "@/components/osta/channel-connections-admin"
import { PageHeader } from "@/components/ui/page-header"
import { DesktopOnlyNotice } from "@/components/ui/mobile"

// Cross-tenant channel-manager administration — the master-account topology's control
// room (.agents/docs/DECISIONS.md, 2026-08-02). The Osta layout already bounced anyone
// who isn't internal; the API routes re-assert isInternal independently, so this page's
// only own decision is whether to render the mutating controls.
export default async function OstaChannelManagerPage() {
  const ctx = await requireSession()
  const canManage = hasPermission(ctx, "INTEGRATIONS", "update")

  return (
    <div className="space-y-6">
      <PageHeader title="Channel Manager" tabTitle="Channel Manager · Osta" hint={<>Every enterprise&rsquo;s Beds24 connection, run from the master account: setup, health, webhooks and the shared rate-limit pool. Room and rate mapping stays in each enterprise&rsquo;s own Hub.</>} />
      <DesktopOnlyNotice feature="Channel Manager administration" description="You can still read everything below. To make changes comfortably, open the console on a tablet or computer." />
      <ChannelConnectionsAdmin canManage={canManage} />
    </div>
  )
}
