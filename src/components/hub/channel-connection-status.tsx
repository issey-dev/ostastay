"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowLeftRight, RefreshCw, Building2, CheckCircle2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/ui/error-state"
import { toast } from "@/lib/toast"
import { type Connection, StatusBadge, formatDateTime } from "@/components/hub/connection-shared"

// A property's channel-manager Connection screen — READ-ONLY since 2026-08-03, one
// connection per property since 2026-09-23 (HUB_SETUP_PLAN.md, Phase 4).
//
// Uppsolut connects each property from the Osta console: under the master-account topology
// the invite code belongs to the app owner's Beds24 account, so the tenant has nothing to
// connect WITH. What they need from this screen is the answer to "is this property
// connected, and to which Beds24 property?" — everything downstream of that (mapping,
// checks, bookings, logs) is theirs.
//
// The API refuses the setup actions independently (/api/hub/connections* return 403), so
// this component omitting the buttons is presentation, not the control itself.

type PropertyLink = {
  id: string
  propertyId: string
  propertyName: string
  externalPropertyId: string
  syncEnabled: boolean
  connectionId: string
}

export function ChannelConnectionStatus({ propertyId, canManage }: { propertyId: string; canManage: boolean }) {
  const [connections, setConnections] = useState<Connection[]>([])
  const [links, setLinks] = useState<PropertyLink[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const [connRes, linkRes] = await Promise.all([
        fetch(`/api/hub/connections?propertyId=${propertyId}`),
        fetch(`/api/hub/property-links?propertyId=${propertyId}`),
      ])
      if (!connRes.ok || !linkRes.ok) throw new Error("failed")
      const connData = await connRes.json()
      const linkData = await linkRes.json()
      setConnections(connData.connection ? [connData.connection] : [])
      setLinks(linkData.link ? [linkData.link] : [])
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [propertyId])

  useEffect(() => {
    void load()
  }, [load])

  // Read-only diagnostics, deliberately kept for the tenant: "is my connection alive?" is
  // a question they should be able to answer without opening a support ticket. It also
  // doubles as the keep-alive that stops an idle refresh token dying.
  const handleTest = async (c: Connection) => {
    setBusyId(c.id)
    try {
      const res = await fetch(`/api/hub/connections/${c.id}/test`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Could not run the check")
        return
      }
      if (data.connection?.status === "CONNECTED") toast.success("Connection is healthy")
      else toast.error(data.connection?.lastError ?? "Connection is not healthy")
      await load()
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (loadError) return <ErrorState onRetry={() => void load()} />

  if (connections.length === 0) {
    return (
      <EmptyState
        icon={ArrowLeftRight}
        title="This property is not connected yet"
        description="Uppsolut connects each property to the channel manager. Once this property is connected, its room types and rates can be mapped here. Contact Uppsolut to request the connection."
      />
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        This property&apos;s channel-manager connection is managed by Uppsolut. Mapping its room types and rates is
        done here — see Mapping.
      </p>

      {connections.map((c) => {
        const connLinks = links.filter((l) => l.connectionId === c.id)
        return (
          <Card key={c.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    {c.name}
                    <StatusBadge status={c.status} />
                  </CardTitle>
                  <CardDescription>{c.provider === "BEDS24" ? "Beds24" : c.provider} · managed by Uppsolut</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => void handleTest(c)} disabled={busyId === c.id || !canManage}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${busyId === c.id ? "animate-spin" : ""}`} />
                  Check
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
                <div className="flex justify-between gap-4 md:block">
                  <dt className="text-muted-foreground">Last checked</dt>
                  <dd className="font-medium">{formatDateTime(c.lastHealthCheckAt)}</dd>
                </div>
                <div className="flex justify-between gap-4 md:block">
                  <dt className="text-muted-foreground">Inbound webhook</dt>
                  <dd className="font-medium">{c.hasWebhook ? "Installed by Uppsolut" : "Not set up yet"}</dd>
                </div>
              </dl>

              {c.lastError && (
                <p className="text-sm text-destructive">
                  <span className="font-medium">Last error:</span> {c.lastError} — contact Uppsolut if this persists.
                </p>
              )}

              {/* The answer the tenant actually comes to this screen for: which property on the
                  channel side this one is connected to, and whether it is shared yet. */}
              <div className="space-y-2 rounded-md border border-border p-3">
                <span className="text-sm font-medium">Channel-manager property</span>
                {connLinks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Not linked to a channel-manager property yet — contact Uppsolut.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {connLinks.map((l) => (
                      <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="flex items-center gap-1.5">
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                          {l.propertyName}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-muted-foreground">
                            Property ID <code className="font-mono text-xs">{l.externalPropertyId}</code>
                          </span>
                          {l.syncEnabled ? (
                            <Badge variant="default" className="gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Property mapped
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Mapping incomplete</Badge>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
