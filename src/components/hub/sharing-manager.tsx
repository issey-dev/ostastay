"use client"

import { useCallback, useEffect, useState } from "react"
import { Building2, Plus, Trash2, ArrowLeftRight, Eye } from "@/components/icons"
import { AvailabilityPreview } from "@/components/hub/availability-preview"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/ui/error-state"
import { useConfirm } from "@/components/providers/confirm-provider"
import { toast } from "@/lib/toast"

// Sharing / mapping. Like the rest of the Hub this does NOT use useProperty() — properties
// appear here as configuration to be mapped, not as an ambient "current property".

type RoomTypeMap = {
  roomTypeId: string
  roomTypeName: string
  roomTypeCode: string
  isActive: boolean
  externalRoomId: string | null
  shared: boolean
}

type RatePlanMap = {
  ratePlanId: string
  ratePlanName: string
  ratePlanCode: string
  externalRateId: string | null
}

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

export function SharingManager({ canManage }: { canManage: boolean }) {
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
  const [previewFor, setPreviewFor] = useState<PropertyLink | null>(null)

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
      description: "Sharing stops and all room-type and rate mappings for this property are removed.",
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Choose which properties are shared with the channel manager, and how their room types correspond.
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
        <div className="space-y-4">
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
                  <div className="flex shrink-0 items-center gap-3">
                    {/* Available to view-only users too — checking what would be sent is a
                        read, and is the cheapest moment to catch a mapping mistake. */}
                    <Button variant="outline" size="sm" onClick={() => setPreviewFor(link)}>
                      <Eye className="h-4 w-4 mr-2" />
                      Preview
                    </Button>
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

              <CardContent className="space-y-5">
                {/* Sharing cannot be switched on until mapping is complete, so say why up
                    front rather than letting the operator discover it from a failed toggle. */}
                {!link.syncEnabled && !link.ready && (
                  <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
                    {link.unmappedRoomTypeCount > 0
                      ? `Map all ${link.unmappedRoomTypeCount} remaining active room type(s) before sharing can be turned on.`
                      : "Map at least one active room type before sharing can be turned on."}
                  </p>
                )}

                <div>
                  <h4 className="mb-2 text-sm font-semibold">Room types</h4>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Room type</TableHead>
                          <TableHead>Channel room ID</TableHead>
                          <TableHead className="w-[90px] text-right">Share</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {link.roomTypes.map((rt) => (
                          <TableRow key={rt.roomTypeId}>
                            <TableCell>
                              <span className="text-sm font-medium">{rt.roomTypeName}</span>
                              <span className="ml-2 font-mono text-xs text-muted-foreground">{rt.roomTypeCode}</span>
                              {!rt.isActive && (
                                <Badge variant="secondary" className="ml-2">
                                  Inactive
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <MappingInput
                                value={rt.externalRoomId ?? ""}
                                disabled={!canManage}
                                placeholder="Beds24 room ID"
                                onSave={(v) =>
                                  patchLink(link.id, { roomTypeId: rt.roomTypeId, externalRoomId: v }, "Mapping saved")
                                }
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Switch
                                checked={rt.shared}
                                disabled={!canManage || !rt.externalRoomId}
                                onCheckedChange={(checked) =>
                                  void patchLink(link.id, {
                                    roomTypeId: rt.roomTypeId,
                                    externalRoomId: rt.externalRoomId ?? "",
                                    shared: checked,
                                  })
                                }
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {link.ratePlans.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-sm font-semibold">
                      Rate plans <span className="font-normal text-muted-foreground">(optional)</span>
                    </h4>
                    <div className="overflow-x-auto rounded-md border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Rate plan</TableHead>
                            <TableHead>Channel rate ID</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {link.ratePlans.map((rp) => (
                            <TableRow key={rp.ratePlanId}>
                              <TableCell>
                                <span className="text-sm font-medium">{rp.ratePlanName}</span>
                                <span className="ml-2 font-mono text-xs text-muted-foreground">{rp.ratePlanCode}</span>
                              </TableCell>
                              <TableCell>
                                <MappingInput
                                  value={rp.externalRateId ?? ""}
                                  disabled={!canManage}
                                  placeholder="Beds24 rate ID"
                                  onSave={(v) =>
                                    patchLink(link.id, { ratePlanId: rp.ratePlanId, externalRateId: v }, "Mapping saved")
                                  }
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {previewFor && (
        <AvailabilityPreview
          linkId={previewFor.id}
          propertyName={previewFor.propertyName}
          open={previewFor !== null}
          onOpenChange={(o) => !o && setPreviewFor(null)}
        />
      )}

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
              <p className="text-xs text-muted-foreground">Found in the Beds24 control panel against the property.</p>
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

// Saves on blur rather than per keystroke — an id is typed, not incrementally meaningful,
// and a request per character would be pointless traffic.
function MappingInput({
  value,
  placeholder,
  disabled,
  onSave,
}: {
  value: string
  placeholder: string
  disabled?: boolean
  onSave: (value: string) => Promise<boolean>
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  return (
    <Input
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      className="h-8 max-w-[220px] font-mono text-xs"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim() === value) return
        void onSave(draft.trim())
      }}
    />
  )
}
