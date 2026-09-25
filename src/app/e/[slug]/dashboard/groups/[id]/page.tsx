"use client"

import { useEffect, useState, use } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useProperty } from "@/components/providers/property-provider"
import { useSmartBack } from "@/lib/use-smart-back"
import { ArrowLeft, Users, CalendarDays, Wallet, UserPlus, Pencil, Loader2, CheckCircle } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
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
import { DesktopOnlyNotice, MobileActions } from "@/components/ui/mobile"
import { MobileCard, MobileCardList } from "@/components/ui/mobile-card"
import { StatTile } from "@/components/ui/stat-tile"
import { SubmitButton } from "@/components/ui/submit-button"
import { toast } from "@/lib/toast"
import { apiError } from "@/lib/api-error"

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
      if (res.ok) {
        toast.success("Master folio created")
        fetchGroup()
      } else {
        toast.error(await apiError(res, "Couldn't create the master folio. Try again."))
      }
    } catch {
      toast.error("Couldn't create the master folio. Try again.")
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

  const handleSaveEdit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (saving) return
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
        toast.success("Block saved")
        fetchGroup()
      } else {
        setEditError(data.error || "Couldn't save the block. Try again.")
      }
    } catch {
      setEditError("Couldn't save the block. Try again.")
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
      {/* Header — breadcrumbs ("Group Blocks › SMITHWED26") replace the back arrow from md up. */}
      <div className="flex items-start gap-4">
        <Button variant="outline" size="icon" className="mt-0.5 shrink-0 md:hidden" onClick={goBack} title="Back" aria-label="Back">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <PageHeader
          className="min-w-0 flex-1"
          align="end"
          crumb={group.code}
          tabTitle={`${group.code} · ${group.name}`}
          title={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {group.name}
              <StatusBadge label={group.status} status={group.status} />
            </span>
          }
          description={
            group.payeeProfile && (
              <span
                className="inline-flex items-center gap-1 rounded-md bg-info-muted px-1.5 py-0.5 font-sans text-[11px] font-medium text-info ring-1 ring-inset ring-info/20"
                title="Master bill settles to this City-Ledger account"
              >
                <Wallet className="h-3 w-3" /> {group.payeeProfile.companyName || `${group.payeeProfile.firstName} ${group.payeeProfile.lastName ?? ""}`.trim()}
              </span>
            )
          }
          actionsClassName="gap-2 max-md:hidden"
          actions={
            <>
              <Button variant="outline" onClick={openEdit}>
                <Pencil className="w-4 h-4 mr-2" /> Edit block
              </Button>
              {openMaster ? (
                <Button variant="outline" onClick={() => setIsMasterFolioOpen(true)}>
                  <Wallet className="w-4 h-4 mr-2" /> Master folio
                </Button>
              ) : (
                <Button variant="outline" onClick={handleCreateMaster} disabled={creatingMaster || group.status === "CANCELLED"}>
                  {creatingMaster ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wallet className="w-4 h-4 mr-2" />}
                  Create master folio
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
            </>
          }
        />
      </div>

      {/* Phones: the block is read here; the master folio opens (it is a phone-ready
            panel) but editing the block, picking up rooms and setting up the master folio
            are desktop tasks. */}
        {openMaster && (
          <MobileActions
            className="md:hidden"
            primary={
              <Button variant="outline" onClick={() => setIsMasterFolioOpen(true)}>
                <Wallet className="w-4 h-4 mr-2" /> Master folio
              </Button>
            }
          />
        )}
        <DesktopOnlyNotice
          feature="Group setup"
          description="Editing the block, picking up rooms and setting up the master folio are done on a computer. Everything below is up to date."
        />

      {/* Stats — the shared StatTile (DESKTOP_PLAN D8); 2x2 on a phone */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile
          label="Event dates"
          value={`${format(parseISO(group.startDate), "dd MMM")} – ${format(parseISO(group.endDate), "dd MMM yy")}`}
          icon={CalendarDays}
        />
        <StatTile label="Total held" value={String(group.totalRoomsHeld)} icon={Users} />
        <StatTile label="Picked up" value={String(pickedUp)} icon={UserPlus} />
        <StatTile label="Remaining" value={String(remaining)} icon={CheckCircle} />
      </div>

      {/* Room Block — per room type held/picked/remaining */}
      {group.roomHolds?.length > 0 && (
        <Card className="shadow-elevation-1 overflow-hidden">
          <CardHeader className="py-4">
            <CardTitle className="text-lg">Room block</CardTitle>
          </CardHeader>
          {/* Phones: one line per room type instead of a sideways-scrolling table. */}
          <div className="divide-y divide-border border-t border-border md:hidden">
            {group.roomHolds.map((h: any) => {
              const picked = pickedByType[h.roomTypeId] ?? 0
              const rem = Math.max(0, h.quantity - picked)
              return (
                <div key={h.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="min-w-0 font-medium">
                    {h.roomType?.name} <span className="text-xs text-muted-foreground">({h.roomType?.code})</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {picked}/{h.quantity} picked · <span className="font-semibold text-foreground">{rem} left</span>
                  </span>
                </div>
              )
            })}
          </div>
          <div className="overflow-x-auto border-t border-border max-md:hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="pl-6">Room type</TableHead>
                  <TableHead className="text-right">Held</TableHead>
                  <TableHead className="text-right">Picked up</TableHead>
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

      {/* Block Schedule — a wide day grid; phones read the pickups list below instead. */}
      <Card className="shadow-elevation-1 overflow-hidden max-md:hidden">
        <CardHeader className="py-4">
          <CardTitle className="text-lg">Block schedule</CardTitle>
        </CardHeader>
        <div className="-mt-2">
          <GroupScheduleTimeline startDate={group.startDate} endDate={group.endDate} pickups={group.reservations ?? []} slug={slug} />
        </div>
      </Card>

      <GroupERegistrationPanel groupId={unwrappedParams.id} />

      {/* Pickups */}
      <Card className="shadow-elevation-1 overflow-hidden">
        <CardHeader className="py-4 border-b bg-muted/50">
          <CardTitle className="text-lg">Group reservations (pickups)</CardTitle>
        </CardHeader>

        {group.reservations && group.reservations.length > 0 ? (
          <>
          {/* Phones: a card per pickup — name, stay, room, status; tap to open. */}
          <MobileCardList className="p-4">
            {group.reservations.map((res: any) => {
              const st = deriveReservationState(res.status, res.checkInDate, res.checkOutDate, bd)
              return (
                <MobileCard
                  key={res.id}
                  title={`${res.primaryGuest?.firstName ?? ""} ${res.primaryGuest?.lastName ?? ""}`.trim()}
                  subtitle={<span className="font-mono">{res.confirmationNo}</span>}
                  badge={<StatusBadge label={reservationStateLabel(st)} status={st} />}
                  meta={[
                    {
                      label: "Room",
                      value: res.assignments?.[0]?.room?.roomNumber || <span className="font-normal text-muted-foreground">Unassigned</span>,
                    },
                    { label: "Stay", value: `${format(parseISO(res.checkInDate), "dd MMM")} → ${format(parseISO(res.checkOutDate), "dd MMM yy")}`, wide: true },
                  ]}
                  onClick={() => router.push(`/e/${slug}/dashboard/reservations/${res.id}`)}
                />
              )
            })}
          </MobileCardList>
          <div className="overflow-x-auto max-md:hidden">
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
                        <div className="font-medium">
                          {/* A real link (DESKTOP_PLAN D4); a plain click is the row's. */}
                          <Link
                            href={`/e/${slug}/dashboard/reservations/${res.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:underline"
                          >
                            {res.primaryGuest?.firstName} {res.primaryGuest?.lastName}
                          </Link>
                        </div>
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
          </>
        ) : (
          <EmptyState
            icon={Users}
            title="No reservations picked up yet"
            description={'Click "Pickup room" to add a guest to this group.'}
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
        <DialogContent size="lg">
          <form onSubmit={handleSaveEdit} className="contents">
          <DialogHeader>
            <DialogTitle>Edit group block</DialogTitle>
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
                <Label>Cutoff date</Label>
                <DatePicker
                  value={editForm.cutoffDate || null}
                  onChange={(d) => setEditForm((p) => ({ ...p, cutoffDate: d }))}
                  placeholder="No cutoff"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Rooms held (by type)</Label>
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
              <Label>Bill to account (City Ledger)</Label>
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
            <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)} disabled={saving}>Cancel</Button>
            <SubmitButton pending={saving}>Save</SubmitButton>
          </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
