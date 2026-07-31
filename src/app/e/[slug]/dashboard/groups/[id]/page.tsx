"use client"

import { useEffect, useState, use } from "react"
import { useRouter } from "next/navigation"
import { useProperty } from "@/components/providers/property-provider"
import { useSmartBack } from "@/lib/use-smart-back"
import { ArrowLeft, Users, CalendarDays, Wallet, UserPlus, Pencil, Loader2, CheckCircle } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { format, parseISO } from "date-fns"
import { GroupPickupDialog } from "@/components/groups/group-pickup-dialog"
import { GroupERegistrationPanel } from "@/components/groups/group-eregistration-panel"
import { GroupScheduleTimeline } from "@/components/groups/group-schedule-timeline"
import { GroupRoomHoldsEditor, type RoomHold } from "@/components/groups/group-room-holds-editor"
import { WalkInFolioPanel } from "@/components/pos/walk-in-folio-panel"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { DatePicker } from "@/components/ui/date-picker"
import { GROUP_STATUS_TRANSITIONS, GROUP_STATUS_LABEL, type GroupStatus } from "@/lib/group-status"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusBadge } from "@/components/ui/status-badge"
import { deriveReservationState, reservationStateLabel } from "@/lib/reservation-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export default function GroupManagement({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const unwrappedParams = use(params)
  const { slug } = unwrappedParams
  const router = useRouter()
  const goBack = useSmartBack(`/e/${slug}/dashboard/groups`)
  const { currentProperty } = useProperty()
  const bd = currentProperty?.businessDate
  const [group, setGroup] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [isMasterFolioOpen, setIsMasterFolioOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<{ name: string; status: string; cutoffDate: string; roomHolds: RoomHold[]; payeeProfileId: string }>({ name: "", status: "TENTATIVE", cutoffDate: "", roomHolds: [], payeeProfileId: "none" })
  const [accounts, setAccounts] = useState<any[]>([])

  useEffect(() => {
    if (!currentProperty) return
    fetch(`/api/profiles?enterpriseId=${currentProperty.enterpriseId}`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setAccounts(d.filter((p: any) => p.isCreditAccount)) })
      .catch(console.error)
  }, [currentProperty])
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [creatingMaster, setCreatingMaster] = useState(false)

  const handleCreateMaster = async () => {
    setCreatingMaster(true)
    try {
      const res = await fetch(`/api/groups/${unwrappedParams.id}/master-folio`, { method: "POST" })
      if (res.ok) fetchGroup()
    } catch (e) {
      console.error(e)
    } finally {
      setCreatingMaster(false)
    }
  }

  const openEdit = () => {
    setEditForm({
      name: group.name,
      status: group.status,
      cutoffDate: group.cutoffDate ? group.cutoffDate.split("T")[0] : "",
      roomHolds: (group.roomHolds ?? []).map((h: any) => ({ roomTypeId: h.roomTypeId, quantity: h.quantity })),
      payeeProfileId: group.payeeProfileId || "none",
    })
    setEditError(null)
    setIsEditOpen(true)
  }

  const handleSaveEdit = async () => {
    setSaving(true)
    setEditError(null)
    try {
      const res = await fetch(`/api/groups/${unwrappedParams.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name,
          status: editForm.status,
          cutoffDate: editForm.cutoffDate || null,
          roomHolds: editForm.roomHolds.filter((h) => h.roomTypeId && h.quantity > 0),
          payeeProfileId: editForm.payeeProfileId === "none" ? null : editForm.payeeProfileId,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setIsEditOpen(false)
        fetchGroup()
      } else {
        setEditError(data.error || "Failed to update the block.")
      }
    } catch {
      setEditError("An unexpected error occurred.")
    } finally {
      setSaving(false)
    }
  }

  const fetchGroup = async () => {
    if (!currentProperty) return
    setLoading(true)
    try {
      const res = await fetch(`/api/groups/${unwrappedParams.id}`)
      if (res.ok) setGroup(await res.json())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchGroup()
  }, [currentProperty, unwrappedParams.id])

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div>
            <Skeleton className="h-8 w-56 mb-2" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (!group) {
    return <EmptyState icon={Users} title="Group not found" className="py-24" />
  }

  const pickedUp = group.reservations?.length || 0
  const remaining = Math.max(0, group.totalRoomsHeld - pickedUp)
  const openMaster = group.masterFolios?.find((f: any) => !f.isClosed)
  // Rooms picked up per room type (active pickups only) — for the Room Block breakdown.
  const pickedByType: Record<string, number> = {}
  for (const r of group.reservations ?? []) {
    if (["CANCELLED", "NO_SHOW"].includes(r.status)) continue
    const t = r.assignments?.[0]?.roomTypeId
    if (t) pickedByType[t] = (pickedByType[t] ?? 0) + 1
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" className="shrink-0" onClick={goBack} title="Back" aria-label="Back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-3xl font-bold tracking-tight">{group.name}</h2>
              <StatusBadge label={group.status} status={group.status} />
            </div>
            <p className="text-muted-foreground mt-1 font-mono text-sm flex items-center gap-2 flex-wrap">
              Code: {group.code}
              {group.payeeProfile && (
                <span
                  className="inline-flex items-center gap-1 rounded-md bg-info-muted px-1.5 py-0.5 font-sans text-[11px] font-medium text-info ring-1 ring-inset ring-info/20"
                  title="Master bill settles to this City-Ledger account"
                >
                  <Wallet className="h-3 w-3" /> {group.payeeProfile.companyName || `${group.payeeProfile.firstName} ${group.payeeProfile.lastName ?? ""}`.trim()}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openEdit}>
            <Pencil className="w-4 h-4 mr-2" /> Edit Block
          </Button>
          {openMaster ? (
            <Button variant="outline" onClick={() => setIsMasterFolioOpen(true)}>
              <Wallet className="w-4 h-4 mr-2" /> Master Folio
            </Button>
          ) : (
            <Button variant="outline" onClick={handleCreateMaster} disabled={creatingMaster || group.status === "CANCELLED"}>
              {creatingMaster ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wallet className="w-4 h-4 mr-2" />}
              Create Master Folio
            </Button>
          )}
          <GroupPickupDialog
            groupId={group.id}
            onSaved={fetchGroup}
            disabledReason={openMaster ? undefined : "Create the block's master folio before picking up rooms"}
            blockStart={group.startDate?.split("T")[0]}
            blockEnd={group.endDate?.split("T")[0]}
            roomTypeOptions={(group.roomHolds ?? []).map((h: any) => ({ id: h.roomTypeId, name: h.roomType?.name, code: h.roomType?.code }))}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-elevation-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Event Dates</CardTitle>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">
              {format(parseISO(group.startDate), "dd MMM")} – {format(parseISO(group.endDate), "dd MMM yy")}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-elevation-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Held</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-3xl font-bold">{group.totalRoomsHeld}</div></CardContent>
        </Card>
        <Card className="shadow-elevation-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Picked Up</CardTitle>
            <UserPlus className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-3xl font-bold">{pickedUp}</div></CardContent>
        </Card>
        <Card className="shadow-elevation-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Remaining</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-3xl font-bold">{remaining}</div></CardContent>
        </Card>
      </div>

      {/* Room Block — per room type held/picked/remaining */}
      {group.roomHolds?.length > 0 && (
        <Card className="shadow-elevation-1 overflow-hidden">
          <CardHeader className="py-4">
            <CardTitle className="text-lg">Room Block</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto border-t border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="pl-6">Room Type</TableHead>
                  <TableHead className="text-right">Held</TableHead>
                  <TableHead className="text-right">Picked Up</TableHead>
                  <TableHead className="text-right pr-6">Remaining</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.roomHolds.map((h: any) => {
                  const picked = pickedByType[h.roomTypeId] ?? 0
                  const rem = Math.max(0, h.quantity - picked)
                  return (
                    <TableRow key={h.id}>
                      <TableCell className="pl-6 font-medium">
                        {h.roomType?.name} <span className="text-xs text-muted-foreground">({h.roomType?.code})</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{h.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">{picked}</TableCell>
                      <TableCell className="text-right pr-6 tabular-nums font-semibold">{rem}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Block Schedule */}
      <Card className="shadow-elevation-1 overflow-hidden">
        <CardHeader className="py-4">
          <CardTitle className="text-lg">Block Schedule</CardTitle>
        </CardHeader>
        <div className="-mt-2">
          <GroupScheduleTimeline startDate={group.startDate} endDate={group.endDate} pickups={group.reservations ?? []} slug={slug} />
        </div>
      </Card>

      <GroupERegistrationPanel groupId={unwrappedParams.id} />

      {/* Pickups */}
      <Card className="shadow-elevation-1 overflow-hidden">
        <CardHeader className="py-4 border-b bg-muted/50">
          <CardTitle className="text-lg">Group Reservations (Pickups)</CardTitle>
        </CardHeader>

        {group.reservations && group.reservations.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="pl-6">Guest</TableHead>
                  <TableHead>Stay</TableHead>
                  <TableHead>Room</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right pr-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.reservations.map((res: any) => {
                  const st = deriveReservationState(res.status, res.checkInDate, res.checkOutDate, bd)
                  return (
                    <TableRow
                      key={res.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/e/${slug}/dashboard/reservations/${res.id}`)}
                    >
                      <TableCell className="pl-6 align-middle">
                        <div className="font-medium">{res.primaryGuest?.firstName} {res.primaryGuest?.lastName}</div>
                        <div className="text-xs font-mono text-muted-foreground">{res.confirmationNo}</div>
                      </TableCell>
                      <TableCell className="align-middle whitespace-nowrap">
                        <div className="text-sm">{format(parseISO(res.checkInDate), "dd MMM")} → {format(parseISO(res.checkOutDate), "dd MMM yy")}</div>
                      </TableCell>
                      <TableCell className="align-middle text-sm font-semibold">
                        {res.assignments?.[0]?.room?.roomNumber || <span className="text-muted-foreground font-normal">Unassigned</span>}
                      </TableCell>
                      <TableCell className="align-middle">
                        <StatusBadge label={reservationStateLabel(st)} status={st} />
                      </TableCell>
                      <TableCell className="align-middle text-right pr-6" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" onClick={() => router.push(`/e/${slug}/dashboard/reservations/${res.id}`)}>View</Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState
            icon={Users}
            title="No reservations picked up yet"
            description={'Click "Pickup Room" to add a guest to this group.'}
          />
        )}
      </Card>

      <WalkInFolioPanel
        folioId={openMaster?.id ?? null}
        isOpen={isMasterFolioOpen}
        onClose={() => setIsMasterFolioOpen(false)}
        onClosed={fetchGroup}
      />

      {/* Edit Block dialog */}
      <Dialog open={isEditOpen} onOpenChange={(open) => !open && setIsEditOpen(false)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Group Block</DialogTitle>
            <DialogDescription>
              Rooms held cannot go below what&apos;s already picked up; a block with active pickups cannot be cancelled.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <SearchableSelect
                  value={editForm.status}
                  onChange={(v) => setEditForm((p) => ({ ...p, status: v ?? p.status }))}
                  placeholder="Status"
                  options={(GROUP_STATUS_TRANSITIONS[(group.status as GroupStatus)] ?? [group.status as GroupStatus]).map((s) => ({
                    label: GROUP_STATUS_LABEL[s], value: s,
                  }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Cutoff Date</Label>
                <DatePicker
                  value={editForm.cutoffDate || null}
                  onChange={(d) => setEditForm((p) => ({ ...p, cutoffDate: d }))}
                  placeholder="No cutoff"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Rooms Held (by type)</Label>
              <GroupRoomHoldsEditor
                propertyId={currentProperty?.id ?? ""}
                value={editForm.roomHolds}
                onChange={(v) => setEditForm((p) => ({ ...p, roomHolds: v }))}
                startDate={group.startDate?.split("T")[0]}
                endDate={group.endDate?.split("T")[0]}
                excludeGroupBlockId={group.id}
              />
            </div>
            <div className="space-y-2">
              <Label>Bill to Account (City Ledger)</Label>
              <SearchableSelect
                value={editForm.payeeProfileId}
                onChange={(v) => setEditForm((p) => ({ ...p, payeeProfileId: v ?? "none" }))}
                placeholder="No account (bill direct)..."
                options={[
                  { value: "none", label: "None (bill direct)" },
                  ...accounts.map((a) => ({ value: a.upid, label: a.companyName || `${a.firstName} ${a.lastName ?? ""}`.trim() })),
                ]}
              />
              <p className="text-[11px] text-muted-foreground">The master bill settles to this debtor account when closed.</p>
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
