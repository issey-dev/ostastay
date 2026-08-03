"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { useProperty } from "@/components/providers/property-provider"
import { Users, Plus, Calendar as CalendarIcon, UserCheck } from "@/components/icons"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { format, parseISO } from "date-fns"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { ErrorState } from "@/components/ui/error-state"
import { StatusBadge } from "@/components/ui/status-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { InfoHint } from "@/components/ui/info-hint"

export default function GroupsDashboard() {
  const { slug } = useParams<{ slug: string }>()
  const { currentProperty } = useProperty()
  const [groups, setGroups] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const fetchGroups = async () => {
    if (!currentProperty) return
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch(`/api/groups?propertyId=${currentProperty.id}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setGroups(data)
    } catch (e) {
      console.error(e)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchGroups()
  }, [currentProperty])

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl lg:text-3xl">
            Groups & Allotments
            <InfoHint label="Groups & Allotments">Manage blocks of rooms for weddings, corporate events, and tours.</InfoHint>
          </h2>
        </div>
        <Link href={`/e/${slug}/dashboard/groups/new`}>
          <Button className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            New Group Block
          </Button>
        </Link>
      </div>

      {/* Mobile: stacked cards instead of a cramped horizontally-scrolled table */}
      <div className="md:hidden space-y-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
        ) : loadError ? (
          <ErrorState title="Couldn't load groups" onRetry={fetchGroups} className="rounded-xl border border-border bg-card" />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No Group Blocks found"
            description="Create a block to reserve inventory for an event."
            className="rounded-xl border border-border bg-card"
          />
        ) : (
          groups.map((group) => {
            const pickedUp = group.reservations?.length || 0;
            return (
              <Link key={group.id} href={`/e/${slug}/dashboard/groups/${group.id}`} className="block bg-card rounded-xl border border-border p-4 shadow-elevation-1">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <span className="font-mono text-xs font-bold text-foreground bg-muted px-2 py-1 rounded">{group.code}</span>
                    <p className="font-semibold text-foreground mt-1.5">{group.name}</p>
                  </div>
                  <StatusBadge label={group.status} status={group.status} className="shrink-0" />
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                  <CalendarIcon className="w-4 h-4" />
                  {format(parseISO(group.startDate), "dd-MMM")} - {format(parseISO(group.endDate), "dd-MMM-yy")}
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border text-sm">
                  <span className="text-muted-foreground">Rooms Held: <span className="font-semibold text-foreground">{group.totalRoomsHeld}</span></span>
                  <span className="flex items-center gap-1.5 font-semibold text-foreground">
                    <UserCheck className="w-4 h-4" /> {pickedUp} picked up
                  </span>
                </div>
              </Link>
            )
          })
        )}
      </div>

      {/* Tablet/desktop: full table */}
      <div className="hidden md:block bg-card rounded-xl shadow-elevation-1 border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Group Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-center">Rooms Held</TableHead>
              <TableHead className="text-center">Picked Up</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              ))
            ) : loadError ? (
              <TableRow>
                <TableCell colSpan={7} className="py-0">
                  <ErrorState title="Couldn't load groups" onRetry={fetchGroups} />
                </TableCell>
              </TableRow>
            ) : groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-0">
                  <EmptyState
                    icon={Users}
                    title="No Group Blocks found"
                    description="Create a block to reserve inventory for an event."
                  />
                </TableCell>
              </TableRow>
            ) : (
              groups.map((group) => {
                const pickedUp = group.reservations?.length || 0;
                return (
                  <TableRow key={group.id}>
                    <TableCell>
                      <span className="font-mono text-xs font-bold text-foreground bg-muted px-2 py-1 rounded-none">
                        {group.code}
                      </span>
                    </TableCell>
                    <TableCell className="font-semibold text-foreground">{group.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                        {format(parseISO(group.startDate), "dd-MMM")} - {format(parseISO(group.endDate), "dd-MMM-yy")}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <StatusBadge label={group.status} status={group.status} />
                    </TableCell>
                    <TableCell className="text-center font-semibold text-foreground">{group.totalRoomsHeld}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1.5 font-semibold text-foreground">
                        <UserCheck className="w-4 h-4" />
                        {pickedUp}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/e/${slug}/dashboard/groups/${group.id}`}>
                        <Button variant="outline" size="sm">Manage</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
