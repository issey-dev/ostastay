import { ArrowLeftRight } from "@/components/icons"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { JobStatusCard } from "@/components/hub/job-status-card"
import { requireSession } from "@/lib/scope"

// Hub overview. Intentionally thin for now — the Hub shell ships before any
// channel-manager code, so this is the landing surface that proves the shell works and
// gives the sections a home. See .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md for what
// lands here next (Connection, Sharing, Logs).
export default async function HubOverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  // The layout already gated access; this is only here so the page renders per-request
  // rather than being statically prerendered without a session.
  await requireSession()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Hub</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Enterprise-wide connectivity and configuration. Day-to-day property operations live in
          the property dashboard.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
              Channel Manager
            </CardTitle>
            <CardDescription>
              Connect to the channel manager, choose what is shared, and review inbound and
              outbound sync logs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <a
              href={`/e/${slug}/hub/channel-manager`}
              className="text-sm font-medium text-primary hover:underline"
            >
              Open Channel Manager
            </a>
          </CardContent>
        </Card>
      </div>

      <JobStatusCard />
    </div>
  )
}
