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
import { GroupScheduleTimeline } from "@/components/groups/group-schedule-timeline"
import { WalkInFolioPanel } from "@/components/pos/walk-in-folio-panel"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DatePicker } from "@/components/ui/date-picker"
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
  const [editForm, setEditForm] = useState({ name: "", status: "TENTATIVE", totalRoomsHeld: "0", cutoffDate: "" })
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const openEdit = () => {
    setEditForm({
      name: group.name,
      status: group.status,
      totalRoomsHeld: String(group.totalRoomsHeld),
      cutoffDate: group.cutoffDate ? group.cutoffDate.split("T")[0] : "",
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
          totalRoomsHeld: parseInt(editForm.totalRoomsHeld) || 0,
          cutoffDate: editForm.cutoffDate || null,
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" className="shrink-0" onClick={goBack} title="Back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-3xl font-bold tracking-tight">{group.name}</h2>
              <StatusBadge label={group.status} status={group.status} />
            </div>
            <p className="text-muted-foreground mt-1 font-mono text-sm">Code: {group.code}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openEdit}>
            <Pencil className="w-4 h-4 mr-2" /> Edit Block
          </Button>
          <Button
            variant="outline"
            disabled={!group.masterFolios?.length}
            title={group.masterFolios?.length ? undefined : "No master folio has been created for this group yet"}
            onClick={() => setIsMasterFolioOpen(true)}
          >
            <Wallet className="w-4 h-4 mr-2" /> Master Folio
          </Button>
          <GroupPickupDialog groupId={group.id} onSaved={fetchGroup} />
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

      {/* Block Schedule */}
      <Card className="shadow-elevation-1 overflow-hidden">
        <CardHeader className="py-4">
          <CardTitle className="text-lg">Block Schedule</CardTitle>
        </CardHeader>
        <div className="-mt-2">
          <GroupScheduleTimeline startDate={group.startDate} endDate={group.endDate} pickups={group.reservations ?? []} slug={slug} />
        </div>
      </Card>

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
        folioId={group.masterFolios?.[0]?.id ?? null}
        isOpen={isMasterFolioOpen}
        onClose={() => setIsMasterFolioOpen(false)}
        onClosed={fetchGroup}
      />

      {/* Edit Block dialog */}
      <Dialog open={isEditOpen} onOpenChange={(open) => !open && setIsEditOpen(false)}>
        <DialogContent className="sm:max-w-md">
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
                <Select value={editForm.status} onValueChange={(v) => setEditForm((p) => ({ ...p, status: v ?? p.status }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TENTATIVE">Tentative</SelectItem>
                    <SelectItem value="DEFINITE">Definite</SelectItem>
                    <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Rooms Held</Label>
                <Input
                  type="number"
                  min="0"
                  value={editForm.totalRoomsHeld}
                  onChange={(e) => setEditForm((p) => ({ ...p, totalRoomsHeld: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Cutoff Date</Label>
              <DatePicker
                value={editForm.cutoffDate || null}
                onChange={(d) => setEditForm((p) => ({ ...p, cutoffDate: d }))}
                placeholder="No cutoff"
              />
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
