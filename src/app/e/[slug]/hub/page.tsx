import { ArrowLeftRight, Key } from "@/components/icons"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { JobStatusCard } from "@/components/hub/job-status-card"
import { InfoHint } from "@/components/ui/info-hint"
import { redirect } from "next/navigation"
import { requireSession, hasEnterpriseHubAccess } from "@/lib/scope"

// Hub overview. Intentionally thin for now — the Hub shell ships before any
// channel-manager code, so this is the landing surface that proves the shell works and
// gives the sections a home. See .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md for what
// lands here next (Connection, Sharing, Logs).
export default async function HubOverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  // The layout already gated access; this is only here so the page renders per-request
  // rather than being statically prerendered without a session.
  const ctx = await requireSession()
  // The Overview is enterprise-wide. A single-property user goes straight to their own
  // property's setup. (Phase 6 of .agents/docs/HUB_SETUP_PLAN.md rebuilds this page.)
  if (!hasEnterpriseHubAccess(ctx)) redirect(`/e/${slug}/hub/p`)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            Hub
            <InfoHint label="Hub">Enterprise-wide connectivity and configuration. Day-to-day property operations live in the property dashboard.</InfoHint>
          </h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
              Channel Manager
              <InfoHint>Connect to the channel manager, choose what is shared, and review inbound and outbound sync logs.</InfoHint>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <a
              href={`/e/${slug}/hub/enterprise/channel-manager`}
              className="text-sm font-medium text-primary hover:underline"
            >
              Open Channel Manager
            </a>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Key className="h-4 w-4 text-muted-foreground" />
              Booking API
              <InfoHint>API keys for each property&apos;s own brand website, and what it may show and sell online — rooms, excursions and spa.</InfoHint>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <a
              href={`/e/${slug}/hub/enterprise/booking-api`}
              className="text-sm font-medium text-primary hover:underline"
            >
              Open Booking API
            </a>
          </CardContent>
        </Card>
      </div>

      <JobStatusCard />
    </div>
  )
}
