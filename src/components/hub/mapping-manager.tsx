"use client"

import { useCallback, useEffect, useState } from "react"
import { Building2, Plus, Trash2, ArrowLeftRight, Hash, DollarSign, RefreshCw, Settings2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/ui/error-state"
import { useConfirm } from "@/components/providers/confirm-provider"
import { toast } from "@/lib/toast"
import { RoomTypeTab, type RoomTypeMap } from "@/components/hub/mapping/room-type-tab"
import { RatePlanTab, type RatePlanMap } from "@/components/hub/mapping/rate-plan-tab"
import { InventoryTab } from "@/components/hub/mapping/inventory-tab"
import { DefaultsTab } from "@/components/hub/mapping/defaults-tab"

// The Hub's Mapping screen (formerly "Sharing"): which properties are linked to a channel
// manager, and everything that follows from that link. Like the rest of the Hub this does
// NOT use useProperty() — properties appear here as configuration to be mapped, not as an
// ambient "current property".
//
// Five tabs, each scoped to one selected link (Property is the exception — it shows every
// link, since choosing WHICH property is linked is what the other four tabs need first):
//   Property   — which properties are linked, sync on/off, link/unlink.
//   Room Type  — external room code ↔ our room type.
//   Rate Plan  — external price slot ↔ our rate plan, plus sending prices for a date range.
//   Inventory  — resync availability for any date range, on demand.
//   Defaults   — what to fill in in an inbound booking when the channel doesn't say
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

type Connection = { id: string; name: string }
type AvailableProperty = { id: string; name: string }

export function MappingManager({ canManage }: { canManage: boolean }) {
  const confirm = useConfirm()
  const [links, setLinks] = useState<PropertyLink[]>([])
  const [available, setAvailable] = useState<AvailableProperty[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [newPropertyId, setNewPropertyId] = useState("")
  const [newConnectionId, setNewConnectionId] = useState("")
  const [newExternalId, setNewExternalId] = useState("")
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState("property")
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const [linkRes, connRes] = await Promise.all([
        fetch("/api/hub/property-links"),
        fetch("/api/hub/connections"),
      ])
      if (!linkRes.ok || !connRes.ok) throw new Error("failed")
      const linkData = await linkRes.json()
      const connData = await connRes.json()
      setLinks(linkData.links ?? [])
      setAvailable(linkData.availableProperties ?? [])
      setConnections((connData.connections ?? []).map((c: Connection) => ({ id: c.id, name: c.name })))
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Keep the selection valid as links load or change; default to the first one so the
  // per-link tabs are usable immediately rather than starting on an empty state.
  useEffect(() => {
    setSelectedLinkId((current) => {
      if (links.length === 0) return null
      if (current && links.some((l) => l.id === current)) return current
      return links[0].id
    })
  }, [links])

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

  const handleCreateLink = async () => {
    if (!newPropertyId || !newConnectionId || !newExternalId.trim()) {
      toast.error("Choose a property and connection, and enter the channel manager's property ID")
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/hub/property-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: newPropertyId,
          connectionId: newConnectionId,
          externalPropertyId: newExternalId.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Could not link the property")
        return
      }
      toast.success("Property linked")
      setLinkOpen(false)
      setNewPropertyId("")
      setNewConnectionId("")
      setNewExternalId("")
      await load()
    } finally {
      setSaving(false)
    }
  }

  const handleUnlink = async (link: PropertyLink) => {
    const ok = await confirm({
      title: `Unlink ${link.propertyName}?`,
      description: "Sharing stops and all room-type, rate, and default mappings for this property are removed.",
      confirmLabel: "Unlink",
      destructive: true,
    })
    if (!ok) return
    const res = await fetch(`/api/hub/property-links/${link.id}`, { method: "DELETE" })
    if (!res.ok) {
      toast.error("Could not unlink the property")
      return
    }
    toast.success("Property unlinked")
    await load()
  }

  if (loading) return <Skeleton className="h-48 w-full" />
  if (failed) return <ErrorState onRetry={() => void load()} />

  const selectedLink = links.find((l) => l.id === selectedLinkId) ?? null

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-muted">
          <TabsTrigger value="property">
            <Building2 className="h-4 w-4 mr-2" /> Property
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

        <TabsContent value="property" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Choose which properties are shared with the channel manager and turn sharing on once mapped.
            </p>
            {canManage && connections.length > 0 && available.length > 0 && (
              <Button onClick={() => setLinkOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Link a property
              </Button>
            )}
          </div>

          {connections.length === 0 ? (
            <EmptyState
              icon={ArrowLeftRight}
              title="No channel manager connected"
              description="Connect a channel manager first — there is nothing to map a property to yet."
            />
          ) : links.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No properties linked"
              description="Link a property to start mapping its room types to the channel manager."
            />
          ) : (
            <div className="space-y-3">
              {links.map((link) => (
                <Card key={link.id}>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                          {link.propertyName}
                          {link.syncEnabled ? (
                            <Badge variant="default">Sharing</Badge>
                          ) : (
                            <Badge variant="secondary">Not sharing</Badge>
                          )}
                          {!link.ready && link.unmappedRoomTypeCount > 0 && (
                            <Badge variant="destructive">{link.unmappedRoomTypeCount} unmapped</Badge>
                          )}
                        </CardTitle>
                        <CardDescription>
                          {link.connectionName} · channel property{" "}
                          <code className="text-xs">{link.externalPropertyId}</code>
                        </CardDescription>
                      </div>
                      {canManage && (
                        <div className="flex shrink-0 items-center gap-3">
                          <div className="flex items-center gap-2">
                            <Label htmlFor={`share-${link.id}`} className="text-sm">
                              Share
                            </Label>
                            <Switch
                              id={`share-${link.id}`}
                              checked={link.syncEnabled}
                              onCheckedChange={(checked) =>
                                void patchLink(
                                  link.id,
                                  { syncEnabled: checked },
                                  checked ? "Sharing enabled" : "Sharing disabled"
                                )
                              }
                            />
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => void handleUnlink(link)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
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
              ))}
            </div>
          )}
        </TabsContent>

        {links.length === 0 ? (
          ["room-type", "rate-plan", "inventory", "defaults"].map((tab) => (
            <TabsContent key={tab} value={tab}>
              <p className="text-sm text-muted-foreground">Link a property on the Property tab first.</p>
            </TabsContent>
          ))
        ) : (
          <>
            {links.length > 1 && activeTab !== "property" && (
              <div className="mb-4 max-w-sm space-y-2">
                <Label>Managing</Label>
                <SearchableSelect
                  value={selectedLinkId ?? ""}
                  onChange={setSelectedLinkId}
                  options={links.map((l) => ({ label: l.propertyName, value: l.id }))}
                />
              </div>
            )}

            {selectedLink && (
              <>
                <TabsContent value="room-type">
                  <RoomTypeTab
                    roomTypes={selectedLink.roomTypes}
                    canManage={canManage}
                    onPatch={(payload, msg) => patchLink(selectedLink.id, payload, msg)}
                  />
                </TabsContent>
                <TabsContent value="rate-plan">
                  <RatePlanTab
                    linkId={selectedLink.id}
                    propertyName={selectedLink.propertyName}
                    ratePlans={selectedLink.ratePlans}
                    canManage={canManage}
                    onPatch={(payload, msg) => patchLink(selectedLink.id, payload, msg)}
                  />
                </TabsContent>
                <TabsContent value="inventory">
                  <InventoryTab linkId={selectedLink.id} propertyName={selectedLink.propertyName} canManage={canManage} />
                </TabsContent>
                <TabsContent value="defaults">
                  <DefaultsTab
                    linkId={selectedLink.id}
                    propertyId={selectedLink.propertyId}
                    ratePlans={selectedLink.ratePlans}
                    canManage={canManage}
                  />
                </TabsContent>
              </>
            )}
          </>
        )}
      </Tabs>

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link a property</DialogTitle>
            <DialogDescription>
              A property can be linked to one channel manager only — two connections selling the same rooms would
              overbook it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Property</Label>
              <SearchableSelect
                value={newPropertyId}
                onChange={setNewPropertyId}
                placeholder="Select a property..."
                options={available.map((p) => ({ label: p.name, value: p.id }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Connection</Label>
              <SearchableSelect
                value={newConnectionId}
                onChange={setNewConnectionId}
                placeholder="Select a connection..."
                options={connections.map((c) => ({ label: c.name, value: c.id }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="external-property-id">Channel manager property ID</Label>
              <Input
                id="external-property-id"
                value={newExternalId}
                onChange={(e) => setNewExternalId(e.target.value)}
                placeholder="e.g. 123456"
              />
              <p className="text-xs text-muted-foreground">Found in the channel manager&rsquo;s control panel against the property.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreateLink()} disabled={saving}>
              {saving ? "Linking..." : "Link property"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
