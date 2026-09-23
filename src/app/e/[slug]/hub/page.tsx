import Link from "next/link"
import { requireSession } from "@/lib/scope"
import { loadHubOverview, type ChannelStatus, type OverviewBanner } from "@/lib/hub-overview"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { InfoHint } from "@/components/ui/info-hint"
import { AlertTriangle, ArrowLeftRight, ArrowRight, CheckCircle2, XCircle } from "@/components/icons"
import { cn } from "@/lib/utils"

// Hub Overview — "maintenance and config" (owner, 2026-09-23; HUB_SETUP_PLAN.md Phase 6).
// A banner appears only when something needs attention and links straight to the fix;
// when all is well the page says so. Plus each property's channel-manager status. Every
// check lives in src/lib/hub-overview.ts, scoped to what this user may set up.
export default async function HubOverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ctx = await requireSession()
  const { banners, channels } = await loadHubOverview(ctx, slug)
  const critical = banners.filter((b) => b.severity === "critical").length

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
          Overview
          <InfoHint label="Overview">
            What needs attention across the properties you set up: missing setup, Green Tax register issues, channel
            manager problems and failed background jobs. Nothing shows here when everything is in order.
          </InfoHint>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {banners.length === 0
            ? "Everything is set up — nothing needs attention."
            : `${banners.length} item${banners.length === 1 ? "" : "s"} need${banners.length === 1 ? "s" : ""} attention${critical ? ` — ${critical} blocking` : ""}.`}
        </p>
      </div>

      {banners.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success-muted px-4 py-3 text-sm text-success">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          All setup checks pass.
        </div>
      ) : (
        <div className="space-y-3">
          {banners.map((b) => <Banner key={b.id} banner={b} />)}
        </div>
      )}

      {channels && channels.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
              Channel manager
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {channels.map((c) => (
                <li key={c.propertyId} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={c.href} className="font-medium hover:underline">{c.propertyName}</Link>
                  <ChannelBadge status={c.status} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Banner({ banner }: { banner: OverviewBanner }) {
  const critical = banner.severity === "critical"
  const Icon = critical ? XCircle : AlertTriangle
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        critical ? "border-destructive/30 bg-destructive-muted" : "border-warning/40 bg-warning-muted"
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", critical ? "text-destructive" : "text-warning")} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            <span className="text-muted-foreground">{banner.scope} · </span>
            {banner.title}
          </p>
          <p className="text-sm text-muted-foreground">{banner.detail}</p>
        </div>
      </div>
      {banner.href && banner.actionLabel && (
        <Link
          href={banner.href}
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted sm:self-center"
        >
          {banner.actionLabel}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  )
}

const CHANNEL_LABEL: Record<ChannelStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ERROR: "Error",
  NOT_CONNECTED: "Not connected",
}

function ChannelBadge({ status }: { status: ChannelStatus }) {
  const variant = status === "ACTIVE" ? "default" : status === "ERROR" ? "destructive" : status === "INACTIVE" ? "secondary" : "outline"
  return <Badge variant={variant}>{CHANNEL_LABEL[status]}</Badge>
}
