"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { useProperty } from "@/components/providers/property-provider"
import { Users, Plus, Calendar as CalendarIcon, UserCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { format, parseISO } from "date-fns"
import { statusMutedClasses } from "@/lib/status-tone"
import { Skeleton } from "@/components/ui/skeleton"

export default function GroupsDashboard() {
  const { slug } = useParams<{ slug: string }>()
  const { currentProperty } = useProperty()
  const [groups, setGroups] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const fetchGroups = async () => {
    if (!currentProperty) return
    setLoading(true)
    try {
      const res = await fetch(`/api/groups?propertyId=${currentProperty.id}`)
      if (res.ok) {
        const data = await res.json()
        setGroups(data)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchGroups()
  }, [currentProperty])

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <div className="p-2 bg-muted rounded-lg">
              <Users className="w-6 h-6 text-foreground" />
            </div>
            Groups & Allotments
          </h1>
          <p className="text-muted-foreground mt-2">Manage blocks of rooms for weddings, corporate events, and tours.</p>
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
        ) : groups.length === 0 ? (
          <div className="text-center py-16 bg-card rounded-xl border border-border">
            <Users className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No Group Blocks found</p>
            <p className="text-sm text-muted-foreground">Create a block to reserve inventory for an event.</p>
          </div>
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
                  <span className={`text-xs px-2 py-1 rounded-full font-semibold border shrink-0 ${statusMutedClasses(group.status)}`}>
                    {group.status}
                  </span>
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
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-muted text-muted-foreground text-xs uppercase tracking-wider border-b">
              <th className="p-4 font-semibold">Group Code</th>
              <th className="p-4 font-semibold">Name</th>
              <th className="p-4 font-semibold">Dates</th>
              <th className="p-4 font-semibold text-center">Status</th>
              <th className="p-4 font-semibold text-center">Rooms Held</th>
              <th className="p-4 font-semibold text-center">Picked Up</th>
              <th className="p-4 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center py-10 text-muted-foreground">Loading groups...</td>
              </tr>
            ) : groups.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-16">
                  <Users className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-muted-foreground font-medium">No Group Blocks found</p>
                  <p className="text-sm text-muted-foreground">Create a block to reserve inventory for an event.</p>
                </td>
              </tr>
            ) : (
              groups.map((group) => {
                const pickedUp = group.reservations?.length || 0;
                return (
                  <tr key={group.id} className="hover:bg-muted/50 transition-colors">
                    <td className="p-4">
                      <span className="font-mono text-xs font-bold text-foreground bg-muted px-2 py-1 rounded">
                        {group.code}
                      </span>
                    </td>
                    <td className="p-4 font-semibold text-foreground">{group.name}</td>
                    <td className="p-4 text-sm text-muted-foreground flex items-center gap-2">
                      <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                      {format(parseISO(group.startDate), "dd-MMM")} - {format(parseISO(group.endDate), "dd-MMM-yy")}
                    </td>
                    <td className="p-4 text-center">
                      <span className={`text-xs px-2 py-1 rounded-full font-semibold border ${statusMutedClasses(group.status)}`}>
                        {group.status}
                      </span>
                    </td>
                    <td className="p-4 text-center font-semibold text-foreground">{group.totalRoomsHeld}</td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-1.5 font-semibold text-foreground">
                        <UserCheck className="w-4 h-4" />
                        {pickedUp}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <Link href={`/e/${slug}/dashboard/groups/${group.id}`}>
                        <Button variant="outline" size="sm">Manage</Button>
                      </Link>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
