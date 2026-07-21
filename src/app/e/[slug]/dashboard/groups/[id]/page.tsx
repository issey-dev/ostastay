"use client"

import { useEffect, useState, use } from "react"
import { useProperty } from "@/components/providers/property-provider"
import { useRouter } from "next/navigation"
import { ArrowLeft, Users, CalendarDays, Wallet, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { format, parseISO } from "date-fns"
import { GroupPickupDialog } from "@/components/groups/group-pickup-dialog"
import { WalkInFolioPanel } from "@/components/pos/walk-in-folio-panel"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusBadge } from "@/components/ui/status-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export default function GroupManagement({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const unwrappedParams = use(params)
  const { slug } = unwrappedParams
  const { currentProperty } = useProperty()
  const [group, setGroup] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [isMasterFolioOpen, setIsMasterFolioOpen] = useState(false)

  const fetchGroup = async () => {
    if (!currentProperty) return
    setLoading(true)
    try {
      const res = await fetch(`/api/groups/${unwrappedParams.id}`)
      if (res.ok) {
        const data = await res.json()
        setGroup(data)
      }
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
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Skeleton className="h-9 w-9 rounded-none" />
          <div>
            <Skeleton className="h-8 w-56 mb-2" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (!group) {
    return <EmptyState icon={Users} title="Group not found" className="py-24" />
  }

  const pickedUp = group.reservations?.length || 0;
  const remaining = Math.max(0, group.totalRoomsHeld - pickedUp);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <Link href={`/e/${slug}/dashboard/groups`}>
            <Button variant="outline" size="icon" className="shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-bold tracking-tight">{group.name}</h1>
              <StatusBadge label={group.status} status={group.status} />
            </div>
            <p className="text-muted-foreground mt-1 font-mono text-sm">Code: {group.code}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="flex items-center gap-2 flex-1 sm:flex-none"
            disabled={!group.masterFolios?.length}
            title={group.masterFolios?.length ? undefined : "No master folio has been created for this group yet"}
            onClick={() => setIsMasterFolioOpen(true)}
          >
            <Wallet className="w-4 h-4" />
            Master Folio
          </Button>
          <GroupPickupDialog groupId={group.id} onSaved={fetchGroup} />
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-card rounded-xl shadow-elevation-1 border border-border p-5">
          <div className="flex items-center gap-3 text-muted-foreground mb-2">
            <CalendarDays className="w-5 h-5" />
            <h3 className="font-semibold">Event Dates</h3>
          </div>
          <p className="text-lg font-bold text-foreground">
            {format(parseISO(group.startDate), "dd-MMM")} - {format(parseISO(group.endDate), "dd-MMM-yy")}
          </p>
        </div>
        <div className="bg-card rounded-xl shadow-elevation-1 border border-border p-5">
          <div className="flex items-center gap-3 text-muted-foreground mb-2">
            <Users className="w-5 h-5" />
            <h3 className="font-semibold">Total Held</h3>
          </div>
          <p className="text-2xl font-bold text-foreground">{group.totalRoomsHeld}</p>
        </div>
        <div className="bg-card rounded-xl shadow-elevation-1 border border-border p-5">
          <div className="flex items-center gap-3 text-muted-foreground mb-2">
            <UserPlus className="w-5 h-5" />
            <h3 className="font-semibold">Picked Up</h3>
          </div>
          <p className="text-2xl font-bold text-foreground">{pickedUp}</p>
        </div>
        <div className="bg-card rounded-xl shadow-elevation-1 border border-border p-5">
          <div className="flex items-center gap-3 text-muted-foreground mb-2">
            <Users className="w-5 h-5" />
            <h3 className="font-semibold">Remaining</h3>
          </div>
          <p className="text-2xl font-bold text-foreground">{remaining}</p>
        </div>
      </div>

      {/* Reservations List */}
      <div className="bg-card rounded-xl shadow-elevation-1 border border-border overflow-hidden">
        <div className="px-6 py-4 border-b flex justify-between items-center bg-muted">
          <h2 className="text-lg font-bold text-foreground">Group Reservations (Pickups)</h2>
        </div>

        {group.reservations && group.reservations.length > 0 ? (
          <>
            {/* Mobile: stacked cards instead of a cramped horizontally-scrolled table */}
            <div className="md:hidden divide-y divide-border">
              {group.reservations.map((res: any) => (
                <Link key={res.id} href={`/e/${slug}/dashboard/reservations/${res.id}/edit`} className="block p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-foreground">{res.primaryGuest?.firstName} {res.primaryGuest?.lastName}</div>
                      <div className="font-mono text-xs text-muted-foreground mt-0.5">{res.confirmationNo}</div>
                    </div>
                    <StatusBadge label={res.status} status={res.status} className="shrink-0" />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {format(parseISO(res.checkInDate), "dd-MMM")} - {format(parseISO(res.checkOutDate), "dd-MMM")}
                    </span>
                    <span className="font-semibold text-foreground">{res.assignments?.[0]?.room?.roomNumber || "Unassigned"}</span>
                  </div>
                </Link>
              ))}
            </div>

            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead>Res #</TableHead>
                  <TableHead>Guest</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Room</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.reservations.map((res: any) => (
                  <TableRow key={res.id}>
                    <TableCell className="font-mono text-sm text-foreground">{res.confirmationNo}</TableCell>
                    <TableCell className="font-semibold text-foreground">
                      {res.primaryGuest?.firstName} {res.primaryGuest?.lastName}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(parseISO(res.checkInDate), "dd-MMM")} - {format(parseISO(res.checkOutDate), "dd-MMM")}
                    </TableCell>
                    <TableCell className="text-sm font-semibold text-foreground">
                      {res.assignments?.[0]?.room?.roomNumber || "Unassigned"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge label={res.status} status={res.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/e/${slug}/dashboard/reservations/${res.id}/edit`}>
                        <Button variant="ghost" size="sm">
                          View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        ) : (
          <EmptyState
            icon={Users}
            title="No reservations picked up yet"
            description={'Click "Pickup Room" to add a guest to this group.'}
          />
        )}
      </div>

      <WalkInFolioPanel
        folioId={group.masterFolios?.[0]?.id ?? null}
        isOpen={isMasterFolioOpen}
        onClose={() => setIsMasterFolioOpen(false)}
        onClosed={fetchGroup}
      />

    </div>
  )
}
