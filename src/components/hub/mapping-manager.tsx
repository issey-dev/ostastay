"use client"

import { useCallback, useEffect, useState } from "react"
import { Building2, ArrowLeftRight, Hash, DollarSign, RefreshCw, Settings2 } from "@/components/icons"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/ui/error-state"
import { toast } from "@/lib/toast"
import { RoomTypeTab, type RoomTypeMap } from "@/components/hub/mapping/room-type-tab"
import { RatePlanTab, type RatePlanMap } from "@/components/hub/mapping/rate-plan-tab"
import { InventoryTab } from "@/components/hub/mapping/inventory-tab"
import { DefaultsTab } from "@/components/hub/mapping/defaults-tab"

// A property's channel-manager Mapping screen (Hub > the property > Channel Manager >
// Mapping). One connection per property since 2026-09-23 (HUB_SETUP_PLAN.md, Phase 4):
// Uppsolut connects the property and links its channel-manager property from the Osta
// console, so there is nothing to link or unlink here — only this property's link, and
// everything that follows from it:
//   Sharing    — the sync on/off switch, once mapping is complete.
//   Room Type  — external room code ↔ our room type.
//   Rate Plan  — external price slot ↔ our rate plan, plus sending prices for a date range.
//   Inventory  — resync availability for any date range, on demand.
//   Defaults   — what to fill in in an inbound booking when the channel does not say
//                (rate plan, meal plan) — see src/lib/channels/defaults.ts.
//
// The provider is deliberately never named in any of this UI beyond "the channel manager" —
// a connection's `provider` column is what lets it be Beds24 today and something else
// tomorrow without this screen changing at all.

type PropertyLink = {
  id: string
  connectionId: string
  connectionName: string
  propertyId: string
  propertyName: string
  externalPropertyId: string
  syncEnabled: boolean
  roomTypes: RoomTypeMap[]
  ratePlans: RatePlanMap[]
  unmappedRoomTypeCount: number
  ready: boolean
}

export function MappingManager({ propertyId, canManage }: { propertyId: string; canManage: boolean }) {
  const [link, setLink] = useState<PropertyLink | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [activeTab, setActiveTab] = useState("sharing")

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const res = await fetch(`/api/hub/property-links?propertyId=${propertyId}`)
      if (!res.ok) throw new Error("failed")
      setLink((await res.json()).link ?? null)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [propertyId])

  useEffect(() => {
    void load()
  }, [load])

  const patchLink = async (linkId: string, payload: Record<string, unknown>, successMessage?: string) => {
    const res = await fetch(`/api/hub/property-links/${linkId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error ?? "Could not save")
      return false
    }
    if (successMessage) toast.success(successMessage)
    await load()
    return true
  }

  if (loading) return <Skeleton className="h-48 w-full" />
  if (failed) return <ErrorState onRetry={() => void load()} />

  if (!link) {
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
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-muted">
          <TabsTrigger value="sharing">
            <Building2 className="h-4 w-4 mr-2" /> Sharing
          </TabsTrigger>
          <TabsTrigger value="room-type">
            <Hash className="h-4 w-4 mr-2" /> Room Type
          </TabsTrigger>
          <TabsTrigger value="rate-plan">
            <DollarSign className="h-4 w-4 mr-2" /> Rate Plan
          </TabsTrigger>
          <TabsTrigger value="inventory">
            <RefreshCw className="h-4 w-4 mr-2" /> Inventory
          </TabsTrigger>
          <TabsTrigger value="defaults">
            <Settings2 className="h-4 w-4 mr-2" /> Defaults
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sharing" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    {link.propertyName}
                    {link.syncEnabled ? <Badge variant="default">Sharing</Badge> : <Badge variant="secondary">Not sharing</Badge>}
                    {!link.ready && link.unmappedRoomTypeCount > 0 && (
                      <Badge variant="destructive">{link.unmappedRoomTypeCount} unmapped</Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {link.connectionName} · channel property <code className="text-xs">{link.externalPropertyId}</code>
                  </CardDescription>
                </div>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Label htmlFor={`share-${link.id}`} className="text-sm">
                      Share
                    </Label>
                    <Switch
                      id={`share-${link.id}`}
                      checked={link.syncEnabled}
                      onCheckedChange={(checked) =>
                        void patchLink(link.id, { syncEnabled: checked }, checked ? "Sharing enabled" : "Sharing disabled")
                      }
                    />
                  </div>
                )}
              </div>
            </CardHeader>
            {!link.syncEnabled && !link.ready && (
              <CardContent>
                <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
                  {link.unmappedRoomTypeCount > 0
                    ? `Map all ${link.unmappedRoomTypeCount} remaining active room type(s) on the Room Type tab before sharing can be turned on.`
                    : "Map at least one active room type on the Room Type tab before sharing can be turned on."}
                </p>
              </CardContent>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="room-type">
          <RoomTypeTab
            roomTypes={link.roomTypes}
            canManage={canManage}
            onPatch={(payload, msg) => patchLink(link.id, payload, msg)}
          />
        </TabsContent>
        <TabsContent value="rate-plan">
          <RatePlanTab
            linkId={link.id}
            propertyName={link.propertyName}
            ratePlans={link.ratePlans}
            canManage={canManage}
            onPatch={(payload, msg) => patchLink(link.id, payload, msg)}
          />
        </TabsContent>
        <TabsContent value="inventory">
          <InventoryTab linkId={link.id} propertyName={link.propertyName} canManage={canManage} />
        </TabsContent>
        <TabsContent value="defaults">
          <DefaultsTab linkId={link.id} propertyId={link.propertyId} ratePlans={link.ratePlans} canManage={canManage} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
